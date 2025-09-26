from flask import Flask, render_template, Response, jsonify, request
import cv2
import numpy as np
from ultralytics import YOLO
import threading
import time
import json
from collections import deque
import logging
import random
import os

# Get the current directory
current_dir = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__, 
    template_folder=os.path.join(current_dir, 'templates'),
    static_folder=os.path.join(current_dir, 'static')
)

# Logging configuration
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Global variables for traffic data
traffic_data = {
    'ns_queue_length': 0,
    'sn_queue_length': 0,
    'ns_avg_speed': 1.0,
    'sn_avg_speed': 1.0,
    'ns_vehicle_count': 0,
    'sn_vehicle_count': 0,
    'current_signal': 'NS',
    'signal_timer': 0,
    'traffic_reduction': 0.0,
    'camera_status': 'simulated'
}

# Dashboard state
dashboard_state = {
    'selectedJunction': 'anna-salai-mount',
    'emergencyMode': False,
    'manualOverride': False,
    'aiRecommendation': {
        'suggestion': 'Extend NS green phase by 15s to clear queue',
        'confidence': 93,
        'reason': 'High density detected, queue length increasing',
        'accepted': None
    },
    'junctions': {
        'anna-salai-mount': {
            'name': 'Anna Salai - Mount Road',
            'density': 65,
            'queueLength': 8,
            'waitTime': 45,
            'status': 'medium',
            'phase': 'NS Green',
            'timeLeft': 25,
            'emergencyVehicle': False,
            'accident': False,
            'coordinates': [13.0827, 80.2707],
            'signalState': {
                'NS': { 'red': False, 'yellow': False, 'green': True },
                'EW': { 'red': True, 'yellow': False, 'green': False }
            }
        },
        'omr-sholinganallur': {
            'name': 'OMR - Sholinganallur',
            'density': 82,
            'queueLength': 12,
            'waitTime': 75,
            'status': 'high',
            'phase': 'EW Green',
            'timeLeft': 18,
            'emergencyVehicle': True,
            'accident': False,
            'coordinates': [12.8992, 80.2289],
            'signalState': {
                'NS': { 'red': True, 'yellow': False, 'green': False },
                'EW': { 'red': False, 'yellow': False, 'green': True }
            }
        },
        'ecr-mahabalipuram': {
            'name': 'ECR - Mahabalipuram Rd',
            'density': 35,
            'queueLength': 3,
            'waitTime': 20,
            'status': 'low',
            'phase': 'NS Red',
            'timeLeft': 10,
            'emergencyVehicle': False,
            'accident': True,
            'coordinates': [12.6208, 80.1944],
            'signalState': {
                'NS': { 'red': True, 'yellow': False, 'green': False },
                'EW': { 'red': False, 'yellow': False, 'green': True }
            }
        }
    },
    'incidents': [
        {
            'id': 1,
            'type': 'emergency',
            'location': 'OMR Junction',
            'message': 'Ambulance approaching from south',
            'time': '14:23',
            'priority': 'high',
            'details': 'Emergency vehicle detected via OpenCV. Estimated arrival: 2 minutes.',
            'actions': ['Clear traffic signal', 'Alert nearby junctions', 'Contact emergency services'],
            'resolved': False,
            'vehicleType': 'Ambulance',
            'direction': 'South to North',
            'estimatedArrival': '2 min',
            'junctionId': 'omr-sholinganallur'
        }
    ],
    'resolvedIncidents': {}
}

# Traffic signal constants
MIN_GREEN_TIME = 10
MAX_GREEN_TIME = 45
DEFAULT_GREEN_TIME = 20
VEHICLE_THRESHOLD = 3

class VehicleTracker:
    def __init__(self):
        self.tracks = {}
        self.next_id = 0
        self.max_disappeared = 5
    
    def update(self, detections):
        if len(detections) == 0:
            for track_id in list(self.tracks.keys()):
                self.tracks[track_id]['disappeared'] += 1
                if self.tracks[track_id]['disappeared'] > self.max_disappeared:
                    del self.tracks[track_id]
            return []
        
        current_centroids = []
        for detection in detections:
            x1, y1, x2, y2 = detection
            cx = (x1 + x2) // 2
            cy = (y1 + y2) // 2
            current_centroids.append((cx, cy))
        
        if len(self.tracks) == 0:
            for centroid in current_centroids:
                self.tracks[self.next_id] = {
                    'centroid': centroid, 
                    'disappeared': 0, 
                    'positions': deque(maxlen=10), 
                    'speed': 0.0
                }
                self.tracks[self.next_id]['positions'].append(centroid)
                self.next_id += 1
        else:
            track_ids = list(self.tracks.keys())
            for i, centroid in enumerate(current_centroids):
                if i < len(track_ids):
                    track_id = track_ids[i]
                    self.tracks[track_id]['centroid'] = centroid
                    self.tracks[track_id]['positions'].append(centroid)
                    self.tracks[track_id]['disappeared'] = 0
                    if len(self.tracks[track_id]['positions']) >= 2:
                        pos1 = self.tracks[track_id]['positions'][-2]
                        pos2 = self.tracks[track_id]['positions'][-1]
                        distance = np.sqrt((pos2[0]-pos1[0])**2 + (pos2[1]-pos1[1])**2)
                        self.tracks[track_id]['speed'] = distance * 30 / 100.0
        
        return list(self.tracks.values())

class DirectionalCameraProcessor:
    def __init__(self, camera_id, direction_name):
        self.camera_id = camera_id
        self.direction_name = direction_name
        try:
            self.model = YOLO("yolov8n.pt")
            self.model_loaded = True
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
            self.model_loaded = False
        self.vehicle_classes = [2, 3, 5, 7]
        self.tracker = VehicleTracker()
        self.last_data = {'queue_length': 0, 'avg_speed': 1.0, 'vehicle_count': 0}

    def process_frame(self, frame):
        if frame is None:
            return self.last_data, frame
        
        try:
            detections = []
            
            if self.model_loaded:
                results = self.model(frame, stream=True, verbose=False)
                
                for r in results:
                    if hasattr(r, 'boxes') and r.boxes is not None:
                        for box in r.boxes:
                            cls = int(box.cls[0]) if hasattr(box, 'cls') else None
                            conf = float(box.conf[0]) if hasattr(box, 'conf') else 0
                            coords = box.xyxy[0] if hasattr(box, 'xyxy') else None
                            
                            if cls in self.vehicle_classes and coords is not None and conf > 0.3:
                                x1, y1, x2, y2 = map(int, coords)
                                detections.append((x1, y1, x2, y2))
                                cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                                cv2.putText(frame, f'Vehicle {conf:.2f}', (x1, y1-10), 
                                          cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            else:
                # Simulate detections if model not loaded
                height, width = frame.shape[:2]
                for i in range(random.randint(0, 5)):
                    x1 = random.randint(0, width-100)
                    y1 = random.randint(0, height-100)
                    x2 = x1 + random.randint(50, 150)
                    y2 = y1 + random.randint(30, 80)
                    detections.append((x1, y1, x2, y2))
                    cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    cv2.putText(frame, 'Vehicle Sim', (x1, y1-10), 
                              cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            
            tracked = self.tracker.update(detections)
            avg_speed = np.mean([v['speed'] for v in tracked if v['speed'] > 0]) if tracked else 1.0
            
            self.last_data = {
                'queue_length': len(detections), 
                'avg_speed': max(0.1, avg_speed), 
                'vehicle_count': len(tracked)
            }
            
            # Add info text to frame
            status_text = "SIMULATED" if not self.model_loaded else "YOLO ACTIVE"
            cv2.putText(frame, f'{self.direction_name}: {len(detections)} vehicles ({status_text})', 
                       (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            cv2.putText(frame, f'Avg speed: {avg_speed:.1f}', 
                       (10, 60), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            return self.last_data, frame
            
        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            return self.last_data, frame

class SmartTrafficSystem:
    def __init__(self):
        self.ns_processor = DirectionalCameraProcessor(0, "N→S")
        self.sn_processor = DirectionalCameraProcessor(1, "S→N")
        self.cap_ns = None
        self.cap_sn = None
        self.baseline_total_queue = 1
        self.ns_green = True
        self.sn_green = False
        self.signal_timer = time.time()
        self.current_green_time = DEFAULT_GREEN_TIME
        self.running = True
        self.use_simulated_camera = False
        
        self.initialize_cameras()
    
    def initialize_cameras(self):
        """Initialize cameras with better error handling"""
        try:
            # Try different backends
            backends = [cv2.CAP_DSHOW, cv2.CAP_MSMF, cv2.CAP_ANY]
            
            for backend in backends:
                try:
                    self.cap_ns = cv2.VideoCapture(0, backend)
                    if self.cap_ns.isOpened():
                        logger.info(f"NS Camera opened with backend: {backend}")
                        break
                except Exception as e:
                    logger.warning(f"Backend {backend} failed: {e}")
                    continue
            
            if self.cap_ns is None or not self.cap_ns.isOpened():
                logger.warning("Could not open NS camera, using simulated data")
                self.use_simulated_camera = True
                traffic_data['camera_status'] = 'simulated'
                return
            
            # Try to set camera properties
            self.cap_ns.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
            self.cap_ns.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
            self.cap_ns.set(cv2.CAP_PROP_FPS, 15)  # Lower FPS for stability
            
            # Try second camera
            try:
                self.cap_sn = cv2.VideoCapture(1, cv2.CAP_DSHOW)
                if self.cap_sn.isOpened():
                    self.cap_sn.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                    self.cap_sn.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                    self.cap_sn.set(cv2.CAP_PROP_FPS, 15)
                    logger.info("SN Camera opened successfully")
                else:
                    logger.warning("Could not open SN camera, using NS camera for both")
                    self.cap_sn = self.cap_ns
            except:
                logger.warning("Could not open SN camera, using NS camera for both")
                self.cap_sn = self.cap_ns
                
            traffic_data['camera_status'] = 'active'
            
        except Exception as e:
            logger.error(f"Error initializing cameras: {e}")
            self.use_simulated_camera = True
            traffic_data['camera_status'] = 'simulated'
    
    def get_simulated_frame(self):
        """Generate a simulated traffic frame"""
        width, height = 800, 300
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Create road background
        cv2.rectangle(frame, (0, height//3), (width, 2*height//3), (50, 50, 50), -1)
        
        # Add road markings
        for i in range(0, width, 40):
            cv2.rectangle(frame, (i, height//2-5), (i+20, height//2+5), (255, 255, 255), -1)
        
        # Add simulated vehicles
        vehicle_count = random.randint(2, 8)
        for i in range(vehicle_count):
            x = random.randint(50, width-100)
            y = random.randint(height//3+20, 2*height//3-50)
            w, h = random.randint(40, 80), random.randint(20, 40)
            color = (random.randint(100, 255), random.randint(100, 255), random.randint(100, 255))
            
            cv2.rectangle(frame, (x, y), (x+w, y+h), color, -1)
            cv2.rectangle(frame, (x, y), (x+w, y+h), (0, 0, 0), 2)
        
        # Add info text
        cv2.putText(frame, "SIMULATED TRAFFIC FEED", (width//4, 30), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.putText(frame, f"Vehicles detected: {vehicle_count}", (width//4, 70), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        cv2.putText(frame, "Connect camera for real feed", (width//4, height-20), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        return frame
    
    def get_camera_frame(self, camera, processor, direction):
        """Get frame from camera with error handling"""
        try:
            if self.use_simulated_camera:
                frame = self.get_simulated_frame()
                # Simulate realistic data
                simulated_data = {
                    'queue_length': random.randint(2, 10),
                    'avg_speed': 1.0 + random.random() * 2,
                    'vehicle_count': random.randint(1, 8)
                }
                return simulated_data, frame
            
            if camera and camera.isOpened():
                ret, frame = camera.read()
                if ret and frame is not None:
                    data, processed_frame = processor.process_frame(frame)
                    return data, processed_frame
                else:
                    logger.warning(f"Failed to read frame from {direction} camera")
                    # Return simulated frame if camera fails
                    frame = self.get_simulated_frame()
                    simulated_data = {
                        'queue_length': random.randint(1, 5),
                        'avg_speed': 1.0 + random.random(),
                        'vehicle_count': random.randint(1, 5)
                    }
                    return simulated_data, frame
            else:
                # Camera not available, return simulated data
                frame = self.get_simulated_frame()
                simulated_data = {
                    'queue_length': random.randint(1, 5),
                    'avg_speed': 1.0 + random.random(),
                    'vehicle_count': random.randint(1, 5)
                }
                return simulated_data, frame
                
        except Exception as e:
            logger.error(f"Error getting frame from {direction} camera: {e}")
            frame = self.get_simulated_frame()
            simulated_data = {
                'queue_length': random.randint(1, 5),
                'avg_speed': 1.0 + random.random(),
                'vehicle_count': random.randint(1, 5)
            }
            return simulated_data, frame
    
    def calculate_optimal_timing(self):
        ns_demand = traffic_data['ns_queue_length'] / max(0.1, traffic_data['ns_avg_speed'])
        sn_demand = traffic_data['sn_queue_length'] / max(0.1, traffic_data['sn_avg_speed'])
        total_demand = ns_demand + sn_demand
        
        if total_demand > 0:
            if self.ns_green:
                ns_ratio = ns_demand / total_demand
                next_green_time = MIN_GREEN_TIME + (ns_ratio * (MAX_GREEN_TIME - MIN_GREEN_TIME))
            else:
                sn_ratio = sn_demand / total_demand
                next_green_time = MIN_GREEN_TIME + (sn_ratio * (MAX_GREEN_TIME - MIN_GREEN_TIME))
            
            return max(MIN_GREEN_TIME, min(MAX_GREEN_TIME, next_green_time))
        
        return DEFAULT_GREEN_TIME
    
    def update_signals(self):
        current_time = time.time()
        elapsed = current_time - self.signal_timer

        if self.ns_green and traffic_data['sn_vehicle_count'] >= VEHICLE_THRESHOLD and traffic_data['ns_vehicle_count'] < VEHICLE_THRESHOLD:
            self.ns_green = False
            self.sn_green = True
            self.current_green_time = self.calculate_optimal_timing()
            self.signal_timer = current_time
            traffic_data['current_signal'] = 'SN'
        elif self.sn_green and traffic_data['ns_vehicle_count'] >= VEHICLE_THRESHOLD and traffic_data['sn_vehicle_count'] < VEHICLE_THRESHOLD:
            self.sn_green = False
            self.ns_green = True
            self.current_green_time = self.calculate_optimal_timing()
            self.signal_timer = current_time
            traffic_data['current_signal'] = 'NS'
        elif elapsed >= self.current_green_time:
            self.ns_green = not self.ns_green
            self.sn_green = not self.sn_green
            self.current_green_time = self.calculate_optimal_timing()
            self.signal_timer = current_time
            traffic_data['current_signal'] = 'NS' if self.ns_green else 'SN'
        
        traffic_data['signal_timer'] = max(0, self.current_green_time - elapsed)
    
    def process_frames(self):
        try:
            # Process NS camera
            ns_data, _ = self.get_camera_frame(self.cap_ns, self.ns_processor, "NS")
            traffic_data.update({
                'ns_queue_length': ns_data['queue_length'],
                'ns_avg_speed': ns_data['avg_speed'],
                'ns_vehicle_count': ns_data['vehicle_count']
            })
            
            # Process SN camera  
            sn_data, _ = self.get_camera_frame(self.cap_sn, self.sn_processor, "SN")
            traffic_data.update({
                'sn_queue_length': sn_data['queue_length'],
                'sn_avg_speed': sn_data['avg_speed'],
                'sn_vehicle_count': sn_data['vehicle_count']
            })
            
            # Calculate traffic reduction
            total_queue = traffic_data['ns_queue_length'] + traffic_data['sn_queue_length']
            if self.baseline_total_queue == 1:
                self.baseline_total_queue = max(1, total_queue)
            reduction_percent = max(0, (self.baseline_total_queue - total_queue) / self.baseline_total_queue * 100)
            traffic_data['traffic_reduction'] = reduction_percent
            
            self.update_signals()
            
            # Update dashboard state with real traffic data
            self.update_dashboard_state()
            
        except Exception as e:
            logger.error(f"Error processing frames: {e}")
    
    def update_dashboard_state(self):
        """Update the dashboard state with real traffic data"""
        total_vehicles = traffic_data['ns_vehicle_count'] + traffic_data['sn_vehicle_count']
        
        for junction_id in dashboard_state['junctions']:
            junction = dashboard_state['junctions'][junction_id]
            
            # Simulate realistic traffic patterns based on real data
            base_density = min(100, total_vehicles * 8 + random.randint(-10, 10))
            junction['density'] = max(5, min(100, base_density))
            junction['queueLength'] = traffic_data['ns_queue_length'] + traffic_data['sn_queue_length']
            junction['waitTime'] = max(5, junction['density'] * 0.8 + random.randint(-5, 5))
            
            # Update status based on density
            if junction['density'] > 70:
                junction['status'] = 'high'
            elif junction['density'] > 40:
                junction['status'] = 'medium'
            else:
                junction['status'] = 'low'
            
            # Update emergency status based on real conditions
            junction['emergencyVehicle'] = traffic_data['current_signal'] == 'SN' and traffic_data['sn_vehicle_count'] > 8
    
    def get_combined_frame(self):
        """Get a combined frame from both cameras for streaming"""
        try:
            # Get NS frame
            ns_data, frame_ns = self.get_camera_frame(self.cap_ns, self.ns_processor, "NS")
            frame_ns = cv2.resize(frame_ns, (400, 300))
            
            # Get SN frame  
            sn_data, frame_sn = self.get_camera_frame(self.cap_sn, self.sn_processor, "SN")
            frame_sn = cv2.resize(frame_sn, (400, 300))
            
            # Combine frames
            combined = np.hstack([frame_ns, frame_sn])
            
            # Add overall status text
            status = "SIMULATED" if self.use_simulated_camera else "LIVE"
            cv2.putText(combined, f"TRAFFIC MONITORING - {status}", (10, 20), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            return combined
            
        except Exception as e:
            logger.error(f"Error getting combined frame: {e}")
            return self.get_simulated_frame()

# Global traffic system instance
traffic_system = SmartTrafficSystem()

def generate_frames():
    """Generate video frames for streaming"""
    frame_count = 0
    last_time = time.time()
    
    while traffic_system.running:
        try:
            frame = traffic_system.get_combined_frame()
            
            # Calculate FPS
            frame_count += 1
            current_time = time.time()
            if current_time - last_time >= 1.0:
                fps = frame_count
                frame_count = 0
                last_time = current_time
                traffic_data['fps'] = fps
            
            # Encode frame as JPEG
            ret, buffer = cv2.imencode('.jpg', frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            frame_bytes = buffer.tobytes()
            
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            
            time.sleep(0.067)  # ~15 FPS for stability
            
        except Exception as e:
            logger.error(f"Error in frame generation: {e}")
            time.sleep(1)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                   mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/traffic_data')
def get_traffic_data():
    return json.dumps(traffic_data)

@app.route('/dashboard_data')
def get_dashboard_data():
    return jsonify(dashboard_state)

@app.route('/select_junction', methods=['POST'])
def select_junction():
    junction_id = request.json.get('junctionId')
    if junction_id in dashboard_state['junctions']:
        dashboard_state['selectedJunction'] = junction_id
    return jsonify({'success': True})

@app.route('/toggle_emergency', methods=['POST'])
def toggle_emergency():
    dashboard_state['emergencyMode'] = not dashboard_state['emergencyMode']
    return jsonify({'emergencyMode': dashboard_state['emergencyMode']})

@app.route('/manual_control', methods=['POST'])
def manual_control():
    direction = request.json.get('direction')
    return jsonify({'success': True})

@app.route('/resolve_incident', methods=['POST'])
def resolve_incident():
    incident_id = request.json.get('incidentId')
    action = request.json.get('action')
    
    for incident in dashboard_state['incidents']:
        if incident['id'] == incident_id:
            incident['resolved'] = True
            incident['resolvedAction'] = action
            incident['resolvedTime'] = time.strftime('%H:%M')
            dashboard_state['resolvedIncidents'][incident_id] = True
            break
    
    return jsonify({'success': True})

@app.route('/camera_status')
def get_camera_status():
    return jsonify({
        'status': traffic_data['camera_status'],
        'fps': traffic_data.get('fps', 0)
    })

def run_traffic_processing():
    """Background thread for traffic processing"""
    while traffic_system.running:
        traffic_system.process_frames()
        time.sleep(2)  # Update every 2 seconds

if __name__ == '__main__':
    # Start background processing thread
    processing_thread = threading.Thread(target=run_traffic_processing, daemon=True)
    processing_thread.start()
    
    print("\n" + "="*60)
    print("🚦 Smart Traffic Control System Starting...")
    print("="*60)
    print("📊 Dashboard available at: http://localhost:5000")
    print("📹 Camera status:", traffic_data['camera_status'])
    if traffic_data['camera_status'] == 'simulated':
        print("💡 Tip: Connect a webcam for live video processing")
    print("="*60 + "\n")
    
    app.run(debug=True, host='0.0.0.0', port=5000, threaded=True, use_reloader=False)