const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');

// Single shared client
const supabase   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

// Input sanitization helper
const sanitizeInput = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().slice(0, 500); // limit length, trim whitespace
};

const hashPassword   = (p) => bcrypt.hashSync(p, 12);
const verifyPassword = (p, h) => bcrypt.compareSync(p, h);

const generateToken = (user) => jwt.sign(
  { userId: user.id, role: user.role, accountType: user.account_type, companyId: user.company_id },
  JWT_SECRET, { expiresIn: '30d' }
);

const generateRootAdminToken = () => jwt.sign(
  {
    userId: 'admin',
    role: 'ADMIN',
    accountType: 'admin',
    companyId: null,
    isRootAdmin: true,
    username: process.env.ADMIN_USERNAME,
    displayName: process.env.ADMIN_DISPLAY_NAME || process.env.ADMIN_NAME || process.env.ADMIN_USERNAME,
  },
  JWT_SECRET, { expiresIn: '30d' }
);

const verifyToken = (token) => {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
};

const getUsers = async () => {
  const { data, error } = await supabase.from('helixxi_users').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const getCompanies = async () => {
  const { data, error } = await supabase.from('helixxi_companies').select('*').order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
};

const registerIndividual = async ({ username, email, password }) => {
  username = sanitizeInput(username);
  email    = sanitizeInput(email);
  if (!username || !email || !password) throw new Error('All fields required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error('Username can only contain letters, numbers, underscores, dots and hyphens');
  const { data: existing } = await supabase.from('helixxi_users')
    .select('id').or(`username.eq.${username},email.eq.${email}`).limit(1);
  if (existing?.length) throw new Error('Username or email already taken');

  const { error } = await supabase.from('helixxi_users').insert({
    username, email, password_hash: hashPassword(password),
    role: 'INDIVIDUAL', status: 'PENDING', account_type: 'individual',
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { success: true, message: 'Account created. Awaiting approval.' };
};

const registerCompany = async ({ companyName, domain, managerEmail, password, username }) => {
  const { data: existing } = await supabase.from('helixxi_companies')
    .select('id').eq('domain', domain).limit(1);
  if (existing?.length) throw new Error('Company domain already registered');

  const { data: company, error: compErr } = await supabase.from('helixxi_companies').insert({
    company_name: companyName, domain, manager_email: managerEmail,
    status: 'PENDING', plan: 'free', created_at: new Date().toISOString(),
  }).select().single();
  if (compErr) throw new Error(compErr.message);

  const { error: userErr } = await supabase.from('helixxi_users').insert({
    username, email: managerEmail, password_hash: hashPassword(password),
    role: 'MANAGER', status: 'PENDING', account_type: 'company',
    company_id: company.id, created_at: new Date().toISOString(),
  });
  if (userErr) throw new Error(userErr.message);
  return { success: true, message: 'Company registered. Awaiting approval.' };
};

const loginUser = async ({ username, password }) => {
  username = sanitizeInput(username);
  if (!username || !password) throw new Error('Username and password required');
  if (username === process.env.ADMIN_USERNAME) {
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminHash) throw new Error('Admin not configured');
    if (!verifyPassword(password, adminHash)) throw new Error('Invalid credentials');
    const token = generateRootAdminToken();
    return {
      token,
      user: {
        userId: 'admin',
        role: 'ADMIN',
        username: process.env.ADMIN_USERNAME,
        displayName: process.env.ADMIN_DISPLAY_NAME || process.env.ADMIN_NAME || process.env.ADMIN_USERNAME,
        isRootAdmin: true,
      },
    };
  }

  const { data: users } = await supabase.from('helixxi_users')
    .select('*').or(`username.ilike.${username},email.ilike.${username}`).limit(1);
  const user = users?.[0];

  if (!user) throw new Error('Invalid credentials');
  if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid credentials');
  if (user.status === 'PENDING')   throw new Error('Account pending approval');
  if (user.status === 'REJECTED')  throw new Error('Account rejected');
  if (user.status === 'SUSPENDED') throw new Error('Account suspended');

  await supabase.from('helixxi_users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

  const token = generateToken(user);
  return { token, user: { userId: user.id, username: user.username, role: user.role, accountType: user.account_type, companyId: user.company_id } };
};

const updateUserStatus = async (userId, status, approvedBy) => {
  const update = { status };
  if (status === 'APPROVED') { update.approved_at = new Date().toISOString(); update.approved_by = approvedBy; }

  const { data: user, error } = await supabase.from('helixxi_users')
    .update(update).eq('id', userId).select().single();
  if (error) throw new Error(error.message);

  if (status === 'APPROVED' && user.role === 'MANAGER' && user.company_id) {
    await supabase.from('helixxi_companies').update({
      status: 'APPROVED', approved_at: new Date().toISOString(), approved_by: approvedBy,
    }).eq('id', user.company_id);
  }
};

const updateUserRole = async (userId, role, updatedBy) => {
  if (!['INDIVIDUAL', 'MANAGER', 'ADMIN'].includes(role)) {
    throw new Error('Invalid role');
  }

  const { data: user, error } = await supabase.from('helixxi_users')
    .select('id, role, status, company_id, username')
    .eq('id', userId)
    .single();
  if (error || !user) throw new Error('User not found');
  if (user.status !== 'APPROVED') throw new Error('Only approved users can receive role changes');

  const accountType = role === 'ADMIN' ? 'admin' : (user.company_id ? 'company' : 'individual');
  const { error: updateErr } = await supabase.from('helixxi_users')
    .update({
      role,
      account_type: accountType,
      approved_by: updatedBy,
    })
    .eq('id', userId);
  if (updateErr) throw new Error(updateErr.message);

  return { ...user, role, account_type: accountType };
};

const updateUserPassword = async (userId, password, updatedBy) => {
  if (!userId || !password) throw new Error('User and password are required');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');

  const { data: user, error } = await supabase
    .from('helixxi_users')
    .select('id, username, email, status')
    .eq('id', userId)
    .single();
  if (error || !user) throw new Error('User not found');

  const { error: updateErr } = await supabase
    .from('helixxi_users')
    .update({
      password_hash: hashPassword(password),
      approved_by: updatedBy,
    })
    .eq('id', userId);
  if (updateErr) throw new Error(updateErr.message);

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    status: user.status,
  };
};

const validateUserPassword = async ({ userId, password }) => {
  if (!userId || !password) return false;
  const { data: user, error } = await supabase
    .from('helixxi_users')
    .select('id, password_hash, status')
    .eq('id', userId)
    .single();
  if (error || !user || !user.password_hash) return false;
  if (user.status === 'SUSPENDED' || user.status === 'REJECTED') return false;
  return verifyPassword(password, user.password_hash);
};

module.exports = { getUsers, getCompanies, registerIndividual, registerCompany, loginUser, verifyToken, updateUserStatus, updateUserRole, updateUserPassword, hashPassword, validateUserPassword };
