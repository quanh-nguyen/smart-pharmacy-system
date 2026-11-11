// XÓA TOÀN BỘ BẢNG rồi tạo dữ liệu chạy thử: 3 tài khoản, 1 nhà thuốc, thuốc, tồn kho,
// 1 bộ câu hỏi đã duyệt. In ra JWT của từng vai trò để test bằng Postman.
// Chạy: npm run seed
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const { ensureDatabase } = require('../src/config/database');
const buildColdFlu = require('./sampleQuestionnaire');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Không chạy seed trên production');
  await ensureDatabase();
  const {
    sequelize, User, Drug, Pharmacy, Inventory, SymptomQuestionnaire,
  } = require('../src/models');

  await sequelize.drop(); // xóa theo thứ tự phụ thuộc khóa ngoại
  await sequelize.sync();

  const customer = await User.create({ name: 'Khách Hàng A', email: 'customer@example.com', role: 'customer' });
  const owner = await User.create({ name: 'Chủ Nhà Thuốc', email: 'pharmacy@example.com', role: 'pharmacy' });
  const admin = await User.create({ name: 'Quản Trị', email: 'admin@example.com', role: 'admin' });

  const pharmacy = await Pharmacy.create({
    name: 'Nhà thuốc Bách Khoa', ownerId: owner.id, address: '1 Đại Cồ Việt, Hà Nội', phone: '0240000000', verified: true,
  });

  const drugRows = [
    { name: 'Paracetamol', activeIngredient: 'Paracetamol', strength: '500mg', dosageForm: 'Viên nén' },
    { name: 'Loratadine', activeIngredient: 'Loratadine', strength: '10mg', dosageForm: 'Viên nén' },
    { name: 'Oresol', activeIngredient: 'Natri clorid, Kali clorid, Glucose', strength: '4.1g', dosageForm: 'Gói bột' },
    { name: 'Amoxicillin', activeIngredient: 'Amoxicillin', strength: '500mg', dosageForm: 'Viên nang', isPrescription: true },
    { name: 'Alphachoay', activeIngredient: 'Chymotrypsin', strength: '4.2mg', dosageForm: 'Viên nén' },
  ];
  // create từng dòng để chắc chắn lấy đúng id
  const drugs = [];
  for (const row of drugRows) drugs.push(await Drug.create(row));
  const [paracetamol, loratadine, oresol] = drugs;
  const prices = [1000, 3000, 2500, 4000, 2000];

  await Inventory.bulkCreate(
    drugs.map((d, i) => ({ pharmacyId: pharmacy.id, drugId: d.id, quantity: 100, price: prices[i] })),
  );

  await SymptomQuestionnaire.create({
    ...buildColdFlu({ paracetamol: paracetamol.id, loratadine: loratadine.id, oresol: oresol.id }),
    status: 'approved',
    createdBy: admin.id,
    approvedBy: admin.id,
    approvedAt: new Date(),
  });

  const sign = (u, extra = {}) => jwt.sign({ id: u.id, role: u.role, ...extra }, env.jwtSecret, { expiresIn: '7d' });

  console.log('\n=== Seed xong ===');
  console.log('pharmacyId :', pharmacy.id);
  console.log('drugs      :', drugs.map((d) => `${d.name}=${d.id}`).join(', '));
  console.log('\nTOKEN customer:', sign(customer));
  console.log('\nTOKEN pharmacy:', sign(owner, { pharmacyId: pharmacy.id }));
  console.log('\nTOKEN admin   :', sign(admin));

  await sequelize.close();
}

main().catch((err) => {
  console.error(err.original?.sqlMessage || err);
  process.exit(1);
});
