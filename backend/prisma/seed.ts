// ============================================================
// ALFA — Database Seed (Demo Data for Trial Testing)
// Run: npx prisma db seed
// ============================================================

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding ALFA demo data...');

  // ─── Demo Tenant: Restaurant ─────────────────────────────
  const restaurant = await prisma.tenant.upsert({
    where:  { ownerEmail: 'admin@alfa.demo' },
    update: {},
    create: {
      businessName:    'Spice Garden Restaurant',
      ownerEmail:      'admin@alfa.demo',
      ownerName:       'Raj Sharma',
      businessType:    'restaurant',
      waPhoneDisplay:  '+91 98765 43210',
      waConnected:     false, // Will use mock mode
      chromaCollection: 'tenant_demo_restaurant',
      isActive:        true,

      // AI Config
      aiConfig: {
        create: {
          systemPrompt: `You are a helpful WhatsApp assistant for Spice Garden Restaurant.

ABOUT US:
- We are a North Indian restaurant in Bangalore
- Working hours: Mon-Sun 11 AM to 11 PM
- We offer dine-in, takeaway, and home delivery (within 5km)
- Minimum order for delivery: ₹200
- Delivery charge: ₹40 (free above ₹500)

POPULAR ITEMS:
- Butter Chicken (half): ₹280, (full): ₹480
- Paneer Tikka Masala (half): ₹240, (full): ₹420
- Dal Makhani: ₹180
- Garlic Naan: ₹50
- Family Combo (serves 4): ₹750

RULES:
- For orders: collect Name, Items, Quantity, Delivery Address
- For complaints: apologize and say manager will call back within 1 hour
- Always be warm and helpful`,
          modelName:    'llama3',
          temperature:  0.7,
          language:     'auto',
          businessHours: {
            mon: { open: '11:00', close: '23:00' },
            tue: { open: '11:00', close: '23:00' },
            wed: { open: '11:00', close: '23:00' },
            thu: { open: '11:00', close: '23:00' },
            fri: { open: '11:00', close: '23:00' },
            sat: { open: '11:00', close: '23:00' },
            sun: { open: '11:00', close: '23:00' }
          }
        }
      },

      // Subscription (trial)
      subscription: {
        create: {
          plan:   'professional',
          status: 'trial',
          amount: 0
        }
      }
    }
  });

  // ─── Demo Products ────────────────────────────────────────
  const products = [
    { name: 'Butter Chicken (Half)', price: 280, category: 'Main Course', stockQuantity: -1, isAvailable: true },
    { name: 'Butter Chicken (Full)', price: 480, category: 'Main Course', stockQuantity: -1, isAvailable: true },
    { name: 'Paneer Tikka Masala',   price: 240, category: 'Main Course', stockQuantity: -1, isAvailable: true },
    { name: 'Dal Makhani',           price: 180, category: 'Main Course', stockQuantity: -1, isAvailable: true },
    { name: 'Garlic Naan',           price: 50,  category: 'Breads',      stockQuantity: -1, isAvailable: true },
    { name: 'Butter Roti',           price: 35,  category: 'Breads',      stockQuantity: -1, isAvailable: true },
    { name: 'Veg Biryani',           price: 200, category: 'Rice',        stockQuantity: -1, isAvailable: true },
    { name: 'Chicken Biryani',       price: 260, category: 'Rice',        stockQuantity: -1, isAvailable: true },
    { name: 'Family Combo (4 pax)',  price: 750, category: 'Combos',      stockQuantity: -1, isAvailable: true },
    { name: 'Mango Lassi',           price: 80,  category: 'Drinks',      stockQuantity: 5,  isAvailable: true },
  ];

  for (const p of products) {
    await prisma.product.create({
      data: { ...p, tenantId: restaurant.id }
    });
  }

  // ─── Demo CRM Contacts ────────────────────────────────────
  const contacts = [
    { phone: '+919876543001', name: 'Priya Kapoor',  city: 'Bangalore', totalOrders: 12, totalSpent: 4800, messageCount: 45, tags: ['vip', 'regular'] },
    { phone: '+919876543002', name: 'Amit Mehta',    city: 'Bangalore', totalOrders: 8,  totalSpent: 3200, messageCount: 32, tags: ['regular'] },
    { phone: '+919876543003', name: 'Rohit Gupta',   city: 'Bangalore', totalOrders: 6,  totalSpent: 2400, messageCount: 28, tags: [] },
    { phone: '+919876543004', name: 'Sunita Kumar',  city: 'Bangalore', totalOrders: 4,  totalSpent: 1600, messageCount: 18, tags: [] },
    { phone: '+919876543005', name: 'Neha Patel',    city: 'Bangalore', totalOrders: 2,  totalSpent: 800,  messageCount: 10, tags: ['new'] },
  ];

  for (const c of contacts) {
    await prisma.crmContact.create({
      data: { ...c, tenantId: restaurant.id, lastSeen: new Date() }
    });
  }

  // ─── Demo Orders ──────────────────────────────────────────
  const orders = [
    { orderNumber: 'ORD-001', customerPhone: '+919876543001', customerName: 'Priya Kapoor',  itemsSummary: '2x Butter Chicken, 4x Garlic Naan', totalAmount: 760, status: 'delivered' },
    { orderNumber: 'ORD-002', customerPhone: '+919876543002', customerName: 'Amit Mehta',    itemsSummary: '1x Family Combo',                   totalAmount: 750, status: 'confirmed' },
    { orderNumber: 'ORD-003', customerPhone: '+919876543003', customerName: 'Rohit Gupta',   itemsSummary: '1x Chicken Biryani, 1x Mango Lassi', totalAmount: 340, status: 'preparing' },
    { orderNumber: 'ORD-004', customerPhone: '+919876543004', customerName: 'Sunita Kumar',  itemsSummary: '2x Paneer Tikka Masala, 2x Naan',   totalAmount: 580, status: 'cancelled' },
  ];

  for (const o of orders) {
    await prisma.order.create({
      data: { ...o, tenantId: restaurant.id }
    });
  }

  // ─── Demo Messages (Conversation History) ─────────────────
  const messages = [
    { customerPhone: '+919876543001', content: 'Hi, what are your timings?',              role: 'user', intent: 'faq' },
    { customerPhone: '+919876543001', content: 'We are open Mon-Sun, 11 AM to 11 PM. How can I help you today?', role: 'bot', intent: 'faq' },
    { customerPhone: '+919876543001', content: 'I want to order Butter Chicken and Naan', role: 'user', intent: 'place_order' },
    { customerPhone: '+919876543001', content: 'Sure! How many Butter Chicken and Naan would you like? Full or Half for the chicken?', role: 'bot', intent: 'place_order' },
    { customerPhone: '+919876543002', content: 'Do you have home delivery?',              role: 'user', intent: 'faq' },
    { customerPhone: '+919876543002', content: 'Yes! We deliver within 5km. ₹40 delivery charge, free above ₹500. Minimum order ₹200.', role: 'bot', intent: 'faq' },
  ];

  for (const m of messages) {
    await prisma.message.create({
      data: { ...m, tenantId: restaurant.id, messageType: 'text', createdAt: new Date() }
    });
  }

  // ─── Demo Knowledge Doc ───────────────────────────────────
  await prisma.knowledgeDoc.create({
    data: {
      tenantId:   restaurant.id,
      title:      'Restaurant Menu & Info',
      sourceType: 'text',
      status:     'indexed',
      chunkCount: 24,
      rawContent: 'Spice Garden Restaurant - Full Menu and Information...'
    }
  });

  // ─── Demo Broadcast ───────────────────────────────────────
  await prisma.broadcast.create({
    data: {
      tenantId:       restaurant.id,
      title:          'Weekend Special Offer',
      messageContent: 'Hello! 🎉 This weekend only: 20% off on all combos at Spice Garden! Use code WEEKEND20. Valid Sat-Sun 6-10 PM. Order now: reply ORDER',
      status:         'sent',
      recipientCount: 5,
      sentCount:      5,
      estimatedCost:  5.45,
      actualCost:     5.45,
      sentAt:         new Date()
    }
  });

  console.log('✅ Demo data seeded successfully!');
  console.log('');
  console.log('🔑 Login credentials:');
  console.log('   Email:    admin@alfa.demo');
  console.log('   Password: alfa123');
  console.log('');
  console.log('📱 Mock WhatsApp test numbers:');
  contacts.forEach(c => console.log(`   ${c.name}: ${c.phone}`));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(async () => await prisma.$disconnect());
