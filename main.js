// Dashboard State
let dashboardState = {
    selectedJunction: 'anna-salai-mount',
    emergencyMode: false,
    manualOverride: false,
    selectedIncident: null,
    aiRecommendation: {
        suggestion: 'Extend NS green phase by 15s to clear queue',
        confidence: 93,
        reason: 'High density detected, queue length increasing',
        accepted: null
    },
    junctions: {
        'anna-salai-mount': {
            name: 'Anna Salai - Mount Road',
            density: 65,
            queueLength: 8,
            waitTime: 45,
            status: 'medium',
            phase: 'NS Green',
            timeLeft: 25,
            emergencyVehicle: false,
            accident: false,
            coordinates: [13.0827, 80.2707],
            signalState: {
                NS: { red: false, yellow: false, green: true },
                EW: { red: true, yellow: false, green: false }
            }
        },
        'omr-sholinganallur': {
            name: 'OMR - Sholinganallur',
            density: 82,
            queueLength: 12,
            waitTime: 75,
            status: 'high',
            phase: 'EW Green',
            timeLeft: 18,
            emergencyVehicle: true,
            accident: false,
            coordinates: [12.8992, 80.2289],
            signalState: {
                NS: { red: true, yellow: false, green: false },
                EW: { red: false, yellow: false, green: true }
            }
        },
        'ecr-mahabalipuram': {
            name: 'ECR - Mahabalipuram Rd',
            density: 35,
            queueLength: 3,
            waitTime: 20,
            status: 'low',
            phase: 'NS Red',
            timeLeft: 10,
            emergencyVehicle: false,
            accident: true,
            coordinates: [12.6208, 80.1944],
            signalState: {
                NS: { red: true, yellow: false, green: false },
                EW: { red: false, yellow: false, green: true }
            }
        }
    },
    incidents: [
        {
            id: 1,
            type: 'emergency',
            location: 'OMR Junction',
            message: 'Ambulance approaching from south',
            time: '14:23',
            priority: 'high',
            details: 'Emergency vehicle detected via OpenCV. Estimated arrival: 2 minutes.',
            actions: ['Clear traffic signal', 'Alert nearby junctions', 'Contact emergency services'],
            resolved: false,
            vehicleType: 'Ambulance',
            direction: 'South to North',
            estimatedArrival: '2 min',
            junctionId: 'omr-sholinganallur'
        }
    ],
    openPopups: {},
    resolvedIncidents: {},
    realTrafficData: { ns_queue_length: 0, sn_queue_length: 0, traffic_reduction: 0 }
};

// Map variables
let map;
let markers = {};

// Utility Functions
function getStatusColor(status) {
    switch(status) {
        case 'high': return 'bg-red-500';
        case 'medium': return 'bg-yellow-500';
        case 'low': return 'bg-green-500';
        default: return 'bg-gray-500';
    }
}

function getPriorityColor(priority) {
    switch(priority) {
        case 'high': return 'border-l-red-500 bg-red-50';
        case 'medium': return 'border-l-yellow-500 bg-yellow-50';
        case 'low': return 'border-l-blue-500 bg-blue-50';
        default: return 'border-l-gray-500 bg-gray-50';
    }
}

function getPhaseColor(phase) {
    if (phase.includes('Green')) return 'text-green-400';
    if (phase.includes('Yellow')) return 'text-yellow-400';
    if (phase.includes('Red')) return 'text-red-400';
    return 'text-gray-400';
}

function getIncidentIcon(type) {
    switch(type) {
        case 'emergency': return '⚡';
        case 'accident': return '⚠️';
        case 'congestion': return '👥';
        default: return '🔔';
    }
}

// Initialize the map
function initMap() {
    map = L.map('map-container', {
        zoomControl: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        dragging: true,
        zoomSnap: 0.5,
        zoomDelta: 0.5
    }).setView([13.0827, 80.2707], 11);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(map);
    
    updateMapJunctions();
}

// Update Functions
function updateTime() {
    const now = new Date();
    document.getElementById('current-time').textContent = now.toLocaleTimeString();
}

function updateMetrics() {
    const junction = dashboardState.junctions[dashboardState.selectedJunction];
    const metricsPanel = document.getElementById('metrics-panel');
    
    metricsPanel.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-xs text-gray-400">Traffic Density</span>
            <div class="flex items-center space-x-2">
                <div class="w-20 bg-gray-600 rounded-full h-2">
                    <div class="h-2 rounded-full transition-all duration-500 ${getStatusColor(junction.status)}" style="width: ${junction.density}%"></div>
                </div>
                <span class="text-sm font-bold">${Math.round(junction.density)}%</span>
            </div>
        </div>
        <div class="flex justify-between">
            <span class="text-xs text-gray-400">Queue Length</span>
            <span class="text-sm font-bold">${junction.queueLength} vehicles</span>
        </div>
        <div class="flex justify-between">
            <span class="text-xs text-gray-400">Avg Wait Time</span>
            <span class="text-sm font-bold">${Math.round(junction.waitTime)}s</span>
        </div>
        <div class="flex justify-between">
            <span class="text-xs text-gray-400">Current Phase</span>
            <span class="text-sm font-bold ${getPhaseColor(junction.phase)}">${junction.phase}</span>
        </div>
        <div class="flex justify-between">
            <span class="text-xs text-gray-400">Time Left</span>
            <span class="text-sm font-bold">${junction.timeLeft}s</span>
        </div>
        <div class="bg-blue-900 p-2 rounded border border-blue-700">
            <div class="flex justify-between">
                <span class="text-xs text-blue-300">OpenCV Detection</span>
                <span class="text-xs text-blue-400">Active</span>
            </div>
            <p class="text-xs text-blue-200">Real-time vehicle tracking</p>
        </div>
        ${dashboardState.manualOverride ? '<div class="bg-yellow-900 p-2 rounded border border-yellow-600"><span class="text-xs text-yellow-300 font-medium">Manual Override Active</span></div>' : ''}
    `;
}

function updateIncidentsFeed() {
    const incidentsFeed = document.getElementById('incidents-feed');
    const activeIncidents = dashboardState.incidents.filter(i => !i.resolved);
    const resolvedIncidents = dashboardState.incidents.filter(i => i.resolved);
    
    document.getElementById('incident-count').textContent = activeIncidents.length;
    
    incidentsFeed.innerHTML = activeIncidents.map(incident => {
        const isResolved = dashboardState.resolvedIncidents[incident.id];
        return `
        <div class="border-l-4 pl-3 py-2 rounded cursor-pointer hover:bg-opacity-80 ${getPriorityColor(incident.priority)}" data-incident-id="${incident.id}">
            <div class="flex items-center space-x-2 mb-1">
                <span class="text-sm">${getIncidentIcon(incident.type)}</span>
                <span class="text-xs font-medium text-gray-800">${incident.location}</span>
                <span class="text-xs text-gray-600">${incident.time}</span>
            </div>
            <p class="text-xs text-gray-700 mb-2">${incident.message}</p>
            <div class="flex space-x-2">
                <button onclick="viewIncident(${incident.id})" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors">View</button>
                <button onclick="resolveIncident(${incident.id}, '${incident.actions[0]}')" 
                        class="text-xs ${isResolved ? 'btn-resolved' : 'bg-green-600 hover:bg-green-700'} text-white px-2 py-1 rounded transition-colors"
                        ${isResolved ? 'disabled' : ''}>
                    ${isResolved ? 'Resolved' : 'Resolve'}
                </button>
            </div>
        </div>
    `}).join('');
    
    if (resolvedIncidents.length > 0) {
        incidentsFeed.innerHTML += `
            <div class="mt-4 pt-2 border-t border-gray-600">
                <h4 class="text-xs font-semibold text-gray-400 mb-2">Recently Resolved</h4>
                ${resolvedIncidents.slice(-2).map(incident => `
                    <div class="bg-green-900 bg-opacity-50 p-2 rounded mb-2">
                        <div class="flex items-center space-x-1">
                            <svg class="w-3 h-3 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                            </svg>
                            <span class="text-xs text-green-300">${incident.location}</span>
                        </div>
                        <p class="text-xs text-green-200">Resolved: ${incident.resolvedAction}</p>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function updateCameraFeed() {
    const cameraContainer = document.getElementById('camera-feed-container');
    cameraContainer.innerHTML = `
        <div class="camera-placeholder">
            <span>Junction View - AI Processing Active</span>
        </div>
    `;
}

function updateAIRecommendations() {
    const aiPanel = document.getElementById('ai-recommendations');
    const rec = dashboardState.aiRecommendation;
    
    let content = '';
    
    if (rec.accepted === null) {
        content = `
            <div class="bg-blue-900 p-3 rounded border border-blue-700">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-medium text-blue-300">RL Model Suggestion</span>
                    <span class="text-xs text-blue-400">${rec.confidence}% confidence</span>
                </div>
                <p class="text-xs text-blue-200 mb-2">${rec.suggestion}</p>
                <p class="text-xs text-blue-300 opacity-80 mb-3">${rec.reason}</p>
                <div class="flex space-x-2">
                    <button onclick="acceptRecommendation()" class="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors">Accept</button>
                    <button onclick="declineRecommendation()" class="text-xs bg-gray-600 hover:bg-gray-700 text-white px-3 py-1 rounded transition-colors">Decline</button>
                </div>
            </div>
        `;
    } else if (rec.accepted === true) {
        content = `
            <div class="bg-green-900 p-3 rounded border border-green-700">
                <div class="flex items-center space-x-2 mb-1">
                    <svg class="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                    </svg>
                    <span class="text-xs font-medium text-green-300">Recommendation Applied</span>
                </div>
                <p class="text-xs text-green-200">Signal timing adjusted successfully</p>
            </div>
        `;
    } else {
        content = `
            <div class="bg-red-900 p-3 rounded border border-red-700">
                <div class="flex items-center space-x-2 mb-1">
                    <svg class="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm4.707-5.293a1 1 0 00-1.414-1.414L10 11.586l-3.293-3.293a1 1 0 00-1.414 1.414l4 4a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
                    </svg>
                    <span class="text-xs font-medium text-red-300">Recommendation Declined</span>
                </div>
                <p class="text-xs text-red-200">Manual control maintained</p>
            </div>
        `;
    }
    
    content += `
        <div class="bg-green-900 p-2 rounded border border-green-700">
            <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium text-green-300">OpenCV Detection</span>
                <span class="text-xs text-green-400">Active</span>
            </div>
            <p class="text-xs text-green-200">Traffic flow analysis running</p>
        </div>
    `;
    
    aiPanel.innerHTML = content;
}

function updateMapJunctions() {
    // Clear existing markers
    Object.values(markers).forEach(marker => {
        if (marker) map.removeLayer(marker);
    });
    markers = {};
    
    // Add markers for each junction
    Object.entries(dashboardState.junctions).forEach(([key, junction]) => {
        const isSelected = dashboardState.selectedJunction === key;
        
        let markerClass = junction.status;
        if (junction.emergencyVehicle) markerClass = 'emergency';
        
        const customIcon = L.divIcon({
            className: `junction-marker ${markerClass} ${isSelected ? 'selected' : ''}`,
            html: `<span>${Math.round(junction.density)}%</span>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
        
        const marker = L.marker(junction.coordinates, { icon: customIcon }).addTo(map);
        
        const popupContent = `
            <div class="popup-content">
                <div class="popup-title">${junction.name}</div>
                <div class="popup-detail">
                    <span class="popup-label">Density:</span>
                    <span class="popup-value">${Math.round(junction.density)}%</span>
                </div>
                <div class="popup-detail">
                    <span class="popup-label">Queue:</span>
                    <span class="popup-value">${junction.queueLength} vehicles</span>
                </div>
                <div class="popup-detail">
                    <span class="popup-label">Wait Time:</span>
                    <span class="popup-value">${Math.round(junction.waitTime)}s</span>
                </div>
                <div class="popup-phase">
                    <div class="popup-detail">
                        <span class="popup-label">Signal:</span>
                        <span class="popup-value ${getPhaseColor(junction.phase)}">${junction.phase}</span>
                    </div>
                    <div class="popup-detail">
                        <span class="popup-label">Time Left:</span>
                        <span class="popup-value">${junction.timeLeft}s</span>
                    </div>
                </div>
                <div class="traffic-signal">
                    <div class="signal-direction">
                        <div class="signal-direction-label">N-S</div>
                        <div class="signal-lights">
                            <div class="signal-light red ${junction.signalState.NS.red ? 'active' : ''}"></div>
                            <div class="signal-light yellow ${junction.signalState.NS.yellow ? 'active' : ''}"></div>
                            <div class="signal-light green ${junction.signalState.NS.green ? 'active' : ''}"></div>
                        </div>
                    </div>
                    <div class="signal-direction">
                        <div class="signal-direction-label">E-W</div>
                        <div class="signal-lights">
                            <div class="signal-light red ${junction.signalState.EW.red ? 'active' : ''}"></div>
                            <div class="signal-light yellow ${junction.signalState.EW.yellow ? 'active' : ''}"></div>
                            <div class="signal-light green ${junction.signalState.EW.green ? 'active' : ''}"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        marker.bindPopup(popupContent, {
            closeButton: true,
            autoClose: false,
            closeOnEscapeKey: true,
            autoPan: false
        });
        
        markers[key] = marker;
        
        if (isSelected && dashboardState.openPopups[key]) {
            marker.openPopup();
        }
        
        marker.on('click', () => {
            selectJunction(key);
            
            if (dashboardState.openPopups[key]) {
                marker.closePopup();
                dashboardState.openPopups[key] = false;
            } else {
                Object.keys(dashboardState.openPopups).forEach(junctionKey => {
                    if (junctionKey !== key && dashboardState.openPopups[junctionKey]) {
                        markers[junctionKey].closePopup();
                        dashboardState.openPopups[junctionKey] = false;
                    }
                });
                
                marker.openPopup();
                dashboardState.openPopups[key] = true;
            }
        });
        
        marker.on('popupclose', () => {
            dashboardState.openPopups[key] = false;
        });
    });
}

function updateSignalControls() {
    const signalControls = document.getElementById('signal-controls');
    const junction = dashboardState.junctions[dashboardState.selectedJunction];
    
    const phases = ['NS Green', 'NS Red', 'EW Green', 'EW Red'];
    signalControls.innerHTML = phases.map(phase => {
        const isActive = junction.phase === phase;
        const isDisabled = !dashboardState.manualOverride;
        const color = phase.includes('Green') ? 'green' : 'red';
        
        return `
            <button onclick="handleManualSignalControl('${phase}')" 
                    ${isDisabled ? 'disabled' : ''}
                    class="p-2 rounded text-xs font-medium transition-colors ${
                        isDisabled 
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                            : isActive
                                ? `bg-${color}-600 text-white`
                                : `bg-${color}-500 hover:bg-${color}-600 text-white`
                    }">
                ${phase}
            </button>
        `;
    }).join('');
}

function updateSignalStates() {
    Object.keys(dashboardState.junctions).forEach(key => {
        const junction = dashboardState.junctions[key];
        
        junction.signalState.NS = { red: false, yellow: false, green: false };
        junction.signalState.EW = { red: false, yellow: false, green: false };
        
        if (junction.phase.includes('NS Green')) {
            junction.signalState.NS.green = true;
            junction.signalState.EW.red = true;
        } else if (junction.phase.includes('NS Yellow')) {
            junction.signalState.NS.yellow = true;
            junction.signalState.EW.red = true;
        } else if (junction.phase.includes('EW Green')) {
            junction.signalState.NS.red = true;
            junction.signalState.EW.green = true;
        } else if (junction.phase.includes('EW Yellow')) {
            junction.signalState.NS.red = true;
            junction.signalState.EW.yellow = true;
        } else {
            junction.signalState.NS.red = true;
            junction.signalState.EW.red = true;
        }
    });
}

// Event Handlers
function selectJunction(junctionId) {
    dashboardState.selectedJunction = junctionId;
    document.getElementById('junction-selector').value = junctionId;
    updateDashboard();
}

function toggleEmergencyMode() {
    dashboardState.emergencyMode = !dashboardState.emergencyMode;
    const button = document.getElementById('emergency-toggle');
    
    if (dashboardState.emergencyMode) {
        button.className = 'px-4 py-2 rounded font-medium bg-red-600 text-white transition-colors';
        button.textContent = 'Emergency Mode ON';
    } else {
        button.className = 'px-4 py-2 rounded font-medium bg-gray-600 text-gray-300 hover:bg-gray-500 transition-colors';
        button.textContent = 'Emergency Mode OFF';
    }
    updateDashboard();
}

function toggleManualOverride() {
    dashboardState.manualOverride = !dashboardState.manualOverride;
    const button = document.getElementById('manual-override');
    
    if (dashboardState.manualOverride) {
        button.className = 'px-3 py-1 rounded text-xs font-medium bg-red-600 hover:bg-red-700 text-white transition-colors';
        button.textContent = 'Override ON';
    } else {
        button.className = 'px-3 py-1 rounded text-xs font-medium bg-gray-600 hover:bg-gray-500 text-white transition-colors';
        button.textContent = 'Override OFF';
    }
    updateDashboard();
}

function handleManualSignalControl(phase) {
    if (dashboardState.manualOverride) {
        dashboardState.junctions[dashboardState.selectedJunction].phase = phase;
        dashboardState.junctions[dashboardState.selectedJunction].timeLeft = 30;
        updateSignalStates();
        updateDashboard();
    }
}

function handleEmergencyPreemption() {
    dashboardState.emergencyMode = true;
    dashboardState.junctions[dashboardState.selectedJunction].phase = 'NS Green';
    dashboardState.junctions[dashboardState.selectedJunction].timeLeft = 60;
    updateSignalStates();
    
    const button = document.getElementById('emergency-toggle');
    button.className = 'px-4 py-2 rounded font-medium bg-red-600 text-white transition-colors';
    button.textContent = 'Emergency Mode ON';
    
    updateDashboard();
}

function acceptRecommendation() {
    dashboardState.aiRecommendation.accepted = true;
    dashboardState.junctions[dashboardState.selectedJunction].timeLeft += 15;
    
    const aiPanel = document.getElementById('ai-recommendations');
    const buttons = aiPanel.querySelectorAll('button');
    buttons[0].className = 'text-xs btn-accepted text-white px-3 py-1 rounded';
    buttons[0].textContent = 'Accepted';
    buttons[0].disabled = true;
    buttons[1].className = 'text-xs btn-declined text-white px-3 py-1 rounded';
    buttons[1].textContent = 'Decline';
    buttons[1].disabled = true;
    
    updateDashboard();
}

function declineRecommendation() {
    dashboardState.aiRecommendation.accepted = false;
    
    const aiPanel = document.getElementById('ai-recommendations');
    const buttons = aiPanel.querySelectorAll('button');
    buttons[0].className = 'text-xs btn-declined text-white px-3 py-1 rounded';
    buttons[0].textContent = 'Accept';
    buttons[0].disabled = true;
    buttons[1].className = 'text-xs btn-declined text-white px-3 py-1 rounded';
    buttons[1].textContent = 'Declined';
    buttons[1].disabled = true;
    
    updateDashboard();
}

function viewIncident(incidentId) {
    const incident = dashboardState.incidents.find(i => i.id === incidentId);
    if (!incident) return;
    
    const modal = document.getElementById('incident-modal');
    const modalContent = document.getElementById('modal-content');
    
    modalContent.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div>
                <h2 class="text-lg font-bold text-white mb-1">
                    ${incident.type === 'emergency' ? '🚨 Emergency Vehicle' : ''}
                    ${incident.type === 'accident' ? '⚠️ Traffic Accident' : ''}
                    ${incident.type === 'congestion' ? '🚗 Traffic Congestion' : ''}
                </h2>
                <p class="text-sm text-gray-300">${incident.location} • ${incident.time}</p>
            </div>
            <button onclick="closeModal()" class="text-gray-400 hover:text-white">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>

        <div class="mb-4">
            <h4 class="text-sm font-semibold text-gray-300 mb-1">Details</h4>
            <p class="text-sm text-gray-200">${incident.details}</p>
        </div>

        <div>
            <h4 class="text-sm font-semibold text-gray-300 mb-3">Available Actions</h4>
            <div class="grid grid-cols-1 gap-2">
                ${incident.actions.map(action => {
                    let buttonClass = 'bg-green-600 hover:bg-green-700';
                    if (action.includes('emergency') || action.includes('hospital')) buttonClass = 'bg-red-600 hover:bg-red-700';
                    else if (action.includes('police')) buttonClass = 'bg-blue-600 hover:bg-blue-700';
                    else if (action.includes('Clear') || action.includes('Alert')) buttonClass = 'bg-yellow-600 hover:bg-yellow-700';
                    
                    return `
                        <button onclick="resolveIncident(${incident.id}, '${action}'); closeModal();" 
                                class="p-3 rounded text-sm font-medium transition-colors text-white ${buttonClass}">
                            ${action.includes('hospital') ? '📞 ' : ''}${action.includes('police') ? '🚔 ' : ''}${action}
                        </button>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('incident-modal').classList.add('hidden');
}

function resolveIncident(incidentId, action) {
    const incidentIndex = dashboardState.incidents.findIndex(i => i.id === incidentId);
    if (incidentIndex !== -1) {
        dashboardState.incidents[incidentIndex].resolved = true;
        dashboardState.incidents[incidentIndex].resolvedAction = action;
        dashboardState.incidents[incidentIndex].resolvedTime = new Date().toLocaleTimeString();
        dashboardState.resolvedIncidents[incidentId] = true;
    }
    
    if (action === 'Contact nearest hospital') {
        alert('📞 Contacted Apollo Hospital Chennai - ETA: 8 minutes');
    } else if (action === 'Dispatch traffic police') {
        alert('🚔 Traffic police dispatched from T. Nagar station - ETA: 5 minutes');
    } else if (action === 'Clear traffic signal') {
        handleEmergencyPreemption();
        alert('🚦 Emergency signal preemption activated');
    }
    
    updateDashboard();
}

function updateDashboard() {
    updateTime();
    updateMetrics();
    updateIncidentsFeed();
    updateCameraFeed();
    updateAIRecommendations();
    updateMapJunctions();
    updateSignalControls();
}

function cycleSignalPhases() {
    if (!dashboardState.manualOverride) {
        Object.keys(dashboardState.junctions).forEach(key => {
            const junction = dashboardState.junctions[key];
            
            if (junction.timeLeft > 0) {
                junction.timeLeft -= 1;
            } else {
                const phases = ['NS Green', 'NS Yellow', 'NS Red', 'EW Green', 'EW Yellow', 'EW Red'];
                const currentPhaseIndex = phases.indexOf(junction.phase);
                const nextPhaseIndex = (currentPhaseIndex + 1) % phases.length;
                junction.phase = phases[nextPhaseIndex];
                
                if (junction.phase.includes('Yellow')) {
                    junction.timeLeft = 5;
                } else if (junction.phase.includes('Green')) {
                    junction.timeLeft = dashboardState.emergencyMode ? 60 : 30;
                } else {
                    junction.timeLeft = dashboardState.emergencyMode ? 20 : 25;
                }
            }
        });
        
        updateSignalStates();
        updateDashboard();
    }
}

function simulateTrafficData() {
    const junction = dashboardState.junctions[dashboardState.selectedJunction];
    junction.density = Math.max(10, Math.min(100, junction.density + (Math.random() - 0.5) * 5));
    junction.waitTime = Math.max(5, junction.waitTime + (Math.random() - 0.5) * 10);
    
    if (junction.density > 70) junction.status = 'high';
    else if (junction.density > 40) junction.status = 'medium';
    else junction.status = 'low';
    
    updateDashboard();
}

// New function to fetch real traffic data
async function fetchRealTrafficData() {
    try {
        const response = await fetch('/traffic_data');
        const data = await response.json();
        dashboardState.realTrafficData = data;
        
        document.getElementById('traffic-reduction').textContent = 
            data.traffic_reduction.toFixed(1) + '%';
            
    } catch (error) {
        console.error('Error fetching traffic data:', error);
    }
}

// Camera status and frame rate monitoring
let frameCount = 0;
let lastTime = Date.now();

function updateFrameRate() {
    frameCount++;
    const currentTime = Date.now();
    if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        const frameRateElement = document.getElementById('frame-rate');
        if (frameRateElement) {
            frameRateElement.textContent = fps + ' FPS';
        }
        frameCount = 0;
        lastTime = currentTime;
    }
}

async function checkCameraStatus() {
    try {
        const response = await fetch('/camera_status');
        const status = await response.json();
        
        const cameraStatus = document.getElementById('camera-status');
        const cameraIndicator = document.getElementById('camera-status-indicator');
        const cameraHelp = document.getElementById('camera-help');
        const yoloStatus = document.getElementById('yolo-status');
        const yoloIndicator = document.getElementById('yolo-status-indicator');
        
        if (status.status === 'active') {
            if (cameraStatus) {
                cameraStatus.textContent = 'Live';
                cameraStatus.className = 'text-xs text-green-400';
            }
            if (cameraIndicator) {
                cameraIndicator.className = 'w-2 h-2 bg-green-400 rounded-full animate-pulse';
            }
            if (cameraHelp) {
                cameraHelp.classList.add('hidden');
            }
            if (yoloStatus) {
                yoloStatus.textContent = 'Active';
                yoloStatus.className = 'text-xs text-green-400';
            }
            if (yoloIndicator) {
                yoloIndicator.className = 'w-2 h-2 bg-green-400 rounded-full animate-pulse';
            }
        } else {
            if (cameraStatus) {
                cameraStatus.textContent = 'Simulated';
                cameraStatus.className = 'text-xs text-yellow-400';
            }
            if (cameraIndicator) {
                cameraIndicator.className = 'w-2 h-2 bg-yellow-400 rounded-full animate-pulse';
            }
            if (cameraHelp) {
                cameraHelp.classList.remove('hidden');
            }
            if (yoloStatus) {
                yoloStatus.textContent = 'Simulated';
                yoloStatus.className = 'text-xs text-yellow-400';
            }
            if (yoloIndicator) {
                yoloIndicator.className = 'w-2 h-2 bg-yellow-400 rounded-full animate-pulse';
            }
        }
        
        const frameRateElement = document.getElementById('frame-rate');
        if (frameRateElement) {
            frameRateElement.textContent = (status.fps || 0) + ' FPS';
        }
        
    } catch (error) {
        console.error('Error checking camera status:', error);
    }
}

// Video feed error handling
document.addEventListener('DOMContentLoaded', function() {
    const videoFeed = document.getElementById('video-feed');
    if (videoFeed) {
        videoFeed.onerror = function() {
            const cameraStatus = document.getElementById('camera-status');
            if (cameraStatus) {
                cameraStatus.textContent = 'Error';
                cameraStatus.className = 'text-xs text-red-400';
            }
        };
    }
});

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    
    // Set up event listeners
    document.getElementById('emergency-toggle').addEventListener('click', toggleEmergencyMode);
    document.getElementById('manual-override').addEventListener('click', toggleManualOverride);
    document.getElementById('emergency-preemption').addEventListener('click', handleEmergencyPreemption);
    document.getElementById('junction-selector').addEventListener('change', function(e) {
        selectJunction(e.target.value);
    });

    // Close modal when clicking outside
    document.getElementById('incident-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeModal();
        }
    });

    updateSignalStates();
    updateDashboard();
    
    // Set up intervals
    setInterval(updateTime, 1000);
    setInterval(cycleSignalPhases, 1000);
    setInterval(simulateTrafficData, 3000);
    setInterval(fetchRealTrafficData, 2000);
    setInterval(updateFrameRate, 100);
    setInterval(checkCameraStatus, 3000);
    
    // Initial status check
    checkCameraStatus();
});