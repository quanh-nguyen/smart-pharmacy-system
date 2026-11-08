// Load and validate configuration first; password is never read from environment.
require('../config/env');
const readline = require('node:readline');
const sqlDb = require('../db/mysql');
const connectDB = require('../config/db');
const User = require('../models/User');
const { Roles } = require('../constants/roles');
const { emailSchema, passwordSchema } = require('../validation/commonSchemas');
const { hashPassword } = require('../utils/password');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { toLoggableError } = require('../utils/toLoggableError');

const ask = (question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, (answer) => {
    rl.close();
    resolve(answer);
  });
});

// Supports terminal paste chunks and Unicode characters, without echoing the password.
const readSecret = (prompt, input = process.stdin, output = process.stdout) => new Promise((resolve, reject) => {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    reject(new Error('Cần chạy lệnh trong terminal tương tác để nhập mật khẩu ẩn.'));
    return;
  }

  let secret = '';
  let settled = false;

  const restoreTerminal = () => {
    let restoreError;
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    try {
      if (input.isTTY && typeof input.setRawMode === 'function') input.setRawMode(false);
    } catch (error) {
      restoreError = error;
    }
    try {
      if (typeof input.pause === 'function') input.pause();
    } catch (error) {
      restoreError ||= error;
    }
    try {
      output.write('\n');
    } catch (error) {
      restoreError ||= error;
    }
    if (restoreError) throw restoreError;
  };

  const finish = (error, value) => {
    if (settled) return;
    settled = true;
    let cleanupError;
    try {
      restoreTerminal();
    } catch (caught) {
      cleanupError = caught;
    }

    if (error) reject(error);
    else if (cleanupError) reject(cleanupError);
    else resolve(value);
  };

  const onEnd = () => finish(new Error('Input đã kết thúc trước khi nhập xong mật khẩu (EOF/Ctrl+D).'));

  const onData = (chunk) => {
    const characters = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const character of characters) {
      if (character === '\u0003') {
        finish(new Error('Đã hủy nhập mật khẩu.'));
        return;
      }
      if (character === '\u0004') {
        finish(new Error('Input đã kết thúc trước khi nhập xong mật khẩu (EOF/Ctrl+D).'));
        return;
      }
      if (character === '\r' || character === '\n') {
        finish(null, secret);
        return;
      }
      if (character === '\u007f' || character === '\b') {
        secret = [...secret].slice(0, -1).join('');
        continue;
      }
      if (character >= ' ' && character !== '\u007f') secret += character;
    }
  };

  try {
    output.write(prompt);
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', onData);
    input.once('end', onEnd);
    input.resume();
  } catch (error) {
    finish(error);
  }
});

const main = async () => {
  const suppliedEmail = process.env.ADMIN_EMAIL;
  const emailInput = suppliedEmail || await ask('ADMIN email: ');
  const parsedEmail = emailSchema.safeParse(emailInput);
  if (!parsedEmail.success) throw new ApiError(400, 'Email ADMIN không hợp lệ.');

  const passwordInput = await readSecret('ADMIN password (input hidden): ');
  const parsedPassword = passwordSchema.safeParse(passwordInput);
  if (passwordInput.length < 12) throw new ApiError(400, 'Mật khẩu ADMIN cần tối thiểu 12 ký tự.');
  if (!parsedPassword.success) {
    throw new Error(parsedPassword.error.issues[0].message);
  }

  await connectDB();

  const alreadyExists = await User.exists({ email: parsedEmail.data });
  if (alreadyExists) {
    throw new ApiError(409, 'Email đã tồn tại. Không tự động nâng quyền tài khoản hiện có.');
  }

  const user = await User.create({
    email: parsedEmail.data,
    password: await hashPassword(parsedPassword.data),
    role: Roles.ADMIN
  });

  logger.info({ userId: user._id.toString() }, 'Initial ADMIN account created');
};

if (require.main === module) {
  main()
    .catch((error) => {
      if (error.isOperational) process.stderr.write(`${error.message}\n`);
      else logger.error({ err: toLoggableError(error) }, 'Could not create ADMIN');
      process.exitCode = 1;
    })
    .finally(async () => {
      await sqlDb.disconnect().catch(() => {});
    });
}

module.exports = { main, ask, readSecret };
