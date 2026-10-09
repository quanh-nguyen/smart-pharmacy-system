// Search Drugs

const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const resultsContainer = document.getElementById('results');

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
});

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        resultsContainer.innerHTML = '<p>Vui lòng nhập từ khóa tìm kiếm</p>';
        return;
    }

    try {
        // TODO: Gọi API tìm kiếm thuốc
        // const response = await fetch(`/api/drugs/search?q=${encodeURIComponent(query)}`);
        // const data = await response.json();

        // Dữ liệu mẫu cho demo
        const mockResults = [
            {
                id: 1,
                name: 'Aspirin',
                description: 'Giảm đau, hạ sốt',
                usage: '1-2 viên mỗi 4-6 giờ',
                price: 25000,
                pharmacies: 4
            },
            {
                id: 2,
                name: 'Paracetamol',
                description: 'Giảm đau, hạ sốt',
                usage: '500mg-1000mg mỗi 4-6 giờ',
                price: 15000,
                pharmacies: 2
            }
        ];

        displayResults(mockResults);
    } catch (error) {
        console.error('Lỗi tìm kiếm:', error);
        resultsContainer.innerHTML = '<p style="color: red;">Lỗi khi tìm kiếm. Vui lòng thử lại.</p>';
    }
}

function displayResults(results) {
    if (results.length === 0) {
        resultsContainer.innerHTML = '<p>Không tìm thấy thuốc phù hợp</p>';
        return;
    }

    resultsContainer.innerHTML = results.map(drug => `
        <div class="result-item">
            <h3>${drug.name}</h3>
            <p>${drug.description}</p>
            <p><strong>Cách dùng:</strong> ${drug.usage}</p>
            <div class="meta">
                <span>Giá: ${drug.price.toLocaleString('vi-VN')}₫</span> | 
                <span>${drug.pharmacies} hiệu thuốc có sẵn</span>
            </div>
            <button class="btn btn-primary" style="margin-top: 12px;">Xem Hiệu Thuốc Gần Nhất</button>
        </div>
    `).join('');
}
