// Map & Routing with Leaflet

const map = L.map('map').setView([21.0285, 105.8542], 13); // Hà Nội

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

// Mock pharmacy data
const pharmacies = [
    { id: 1, name: 'Nhà Thuốc Trung Ương', lat: 21.0085, lng: 105.8248, phone: '02438335566' },
    { id: 2, name: 'Nhà Thuốc An Thịnh', lat: 21.0173, lng: 105.8144, phone: '02435568888' },
    { id: 3, name: 'Nhà Thuốc Thanh Bình', lat: 21.0285, lng: 105.8542, phone: '02437688999' },
    { id: 4, name: 'Nhà Thuốc Phương Nam', lat: 21.0295, lng: 105.8540, phone: '02437777888' }
];

// Add pharmacy markers to map
pharmacies.forEach(pharmacy => {
    L.circleMarker([pharmacy.lat, pharmacy.lng], {
        radius: 8,
        fillColor: '#667eea',
        color: '#fff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.8
    }).bindPopup(`<strong>${pharmacy.name}</strong><br>📞 ${pharmacy.phone}`).addTo(map);
});

// Display pharmacy list in sidebar
const pharmaciesList = document.getElementById('pharmacies-list');
pharmaciesList.innerHTML = pharmacies.map(pharmacy => `
    <div class="pharmacy-item" onclick="selectPharmacy(${pharmacy.id}, ${pharmacy.lat}, ${pharmacy.lng})">
        <h4>📍 ${pharmacy.name}</h4>
        <p>📞 ${pharmacy.phone}</p>
    </div>
`).join('');

function selectPharmacy(id, lat, lng) {
    map.setView([lat, lng], 15);
    console.log(`Selected pharmacy ${id}`);
}
