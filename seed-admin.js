require('dotenv').config();

const bcrypt = require('bcryptjs');

const { connectMySQL } = require('./src/config/mysql');
const User = require('./src/models/user.model');

const ADMIN_USERS = [
  {
    name: 'Yashawantha',
    email: 'yashawanthareddyd@gmail.com',
    role: 'superadmin',
    password: process.env.SUPERADMIN_SEED_PASSWORD || 'admin123',
  },
  {
    name: 'D Yashawantha Reddy',
    email: 'yashawanthareddyd@gmail.com',
    role: 'admin',
    password: process.env.ADMIN_SEED_PASSWORD || '@Admin#KPT!103$',
  },
  {
    name: 'KPT Sports',
    email: 'kptsports103@gmail.com',
    role: 'creator',
    password: process.env.CREATOR_SEED_PASSWORD || 'admin123',
  },
];

async function upsertAdminUser(userConfig) {
  let existingUser = await User.findOne({
    role: userConfig.role,
  });

  if (!existingUser) {
    existingUser = await User.findOne({
      email: userConfig.email,
      role: userConfig.role,
    });
  }

  if (existingUser) {
    existingUser.name = userConfig.name;
    existingUser.email = userConfig.email;
    existingUser.password = userConfig.hashedPassword;
    existingUser.clerkUserId = userConfig.email;
    existingUser.profileImage = existingUser.profileImage || 'https://via.placeholder.com/80';
    existingUser.is_verified = true;
    existingUser.otp = null;
    existingUser.otp_expires_at = null;
    await existingUser.save();
    return { user: existingUser, created: false };
  }

  const createdUser = new User({
    name: userConfig.name,
    email: userConfig.email,
    password: userConfig.hashedPassword,
    role: userConfig.role,
    clerkUserId: userConfig.email,
    profileImage: 'https://via.placeholder.com/80',
    is_verified: true,
    otp: null,
    otp_expires_at: null,
  });

  await createdUser.save();
  return { user: createdUser, created: true };
}

async function seedAdmin() {
  try {
    await connectMySQL();
    await User.ensureTable();

    console.log('=== SEEDING MYSQL ADMIN USERS ===');

    for (const adminUser of ADMIN_USERS) {
      const preparedUser = {
        ...adminUser,
        hashedPassword: await bcrypt.hash(adminUser.password, 10),
      };
      const { created } = await upsertAdminUser(preparedUser);
      console.log(
        `${created ? 'Created' : 'Updated'} ${adminUser.role}: ${adminUser.email} / ${adminUser.password}`
      );
    }

    console.log('\nAdmin accounts are ready in MySQL.');
  } catch (error) {
    console.error('Error creating admin users:', error);
    process.exitCode = 1;
  }
}

seedAdmin();
