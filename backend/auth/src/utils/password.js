const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const env = require('../config/env');
const ApiError = require('./ApiError');

let active = 0;
const queue = [];
const acquire = () => new Promise((resolve, reject) => {
  if (active < env.bcryptMaxConcurrent) {
    active += 1;
    return resolve();
  }
  if (queue.length >= env.bcryptMaxQueue) {
    return reject(new ApiError(503, 'Hệ thống đang bận, vui lòng thử lại sau.', undefined, 'SERVICE_BUSY'));
  }
  queue.push(resolve);
});
const release = () => {
  const next = queue.shift();
  if (next) next();
  else active -= 1;
};
const limited = async (task) => {
  await acquire();
  try { return await task(); } finally { release(); }
};

let dummyHashPromise;
const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = limited(() => bcrypt.hash(
      crypto.randomBytes(32).toString('hex'), env.bcryptSaltRounds
    )).catch((error) => {
      dummyHashPromise = undefined;
      throw error;
    });
  }
  return dummyHashPromise;
};
const hashPassword = (plainPassword) => limited(() => bcrypt.hash(plainPassword, env.bcryptSaltRounds));
const comparePassword = (plainPassword, passwordHash) => limited(() => bcrypt.compare(plainPassword, passwordHash));
const needsRehash = (hash) => bcrypt.getRounds(hash) < env.bcryptSaltRounds;

module.exports = { hashPassword, comparePassword, getDummyHash, needsRehash };
