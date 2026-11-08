'use strict';
const { Query, collection, insert, update, findOneAndUpdate } = require('./query');
const { Roles } = require('../constants/roles');
const USER_FIELDS = new Set(['email','password','role','isVerified','isActive','tokenVersion',
  'verifiedAt','verifiedBy','passwordChangedAt','emailVerified','emailVerificationHash',
  'emailVerificationExpiresAt','mfaSecretEncrypted','mfaPendingSecretEncrypted','mfaEnabled',
  'mfaLastUsedStep','adminSafetyEpoch','lastSecurityOperationId','createdAt','updatedAt']);
const EVENT_FIELDS = new Set(['pharmacyId','changedBy','previousValue','newValue',
  'changedAt','requestId','reason']);
const checkFields = (obj, fields) => {
  const unrecognized = Object.keys(obj).find((k) => !fields.has(k));
  if (unrecognized) throw new Error(`Strict model does not allow: ${unrecognized}`);
};
const publicUser = (user) => ({ id: String(user._id), email: user.email, role: user.role,
  isVerified: user.isVerified, createdAt: user.createdAt });
const hydrate = (name, row) => {
  if (!row) return row;
  if (name !== 'users') return row;
  return Object.assign(row, {
    toPublicJSON() { return publicUser(this); },
    toJSON() { return publicUser(this); }
  });
};
const users = () => {
  const name = 'users';
  const source = collection(name);
  const rejectRoleMutation = (mutation) => {
    if (mutation?.role !== undefined || mutation?.$set?.role !== undefined ||
        mutation?.$unset?.role !== undefined || mutation?.$setOnInsert?.role !== undefined)
      throw new Error('Role changes must use the audited account service.');
  };
  return {
    collection: source,
    find: (f={}) => new Query(name,f,{},'many',true),
    findOne: (f={}) => new Query(name,f,{},'one',true),
    findById: (id) => new Query(name,{ _id:id },{},'one',true),
    exists: async (f={}) => {
      const doc = await new Query(name, f, { projection: { _id: 1 } }, 'one')._run();
      return doc ? { _id: doc._id } : null;
    },
    countDocuments: (f={}) => new Query(name,f,{},'count'),
    create: async (payload, options={}) => {
      const isArray = Array.isArray(payload);
      const items = isArray ? payload : [payload];
      const results=[];
      for (const input of items) {
        checkFields(input, USER_FIELDS);
        const role = input.role ?? Roles.CUSTOMER;
        const email = String(input.email || '').trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('Invalid user email');
        if (typeof input.password !== 'string' || !input.password) throw new Error('Invalid password');
        if (!Object.values(Roles).includes(role)) throw new Error('Invalid user role');
        const now = new Date();
        const doc = { email, password:input.password, role, isVerified:role !== Roles.PHARMACY,
          isActive:true, tokenVersion:0, verifiedAt:null, verifiedBy:null, passwordChangedAt:null,
          emailVerified:false, emailVerificationHash:null, emailVerificationExpiresAt:null,
          mfaSecretEncrypted:null, mfaPendingSecretEncrypted:null, mfaEnabled:false,
          mfaLastUsedStep:null, adminSafetyEpoch:0, lastSecurityOperationId:null,
          createdAt:now, updatedAt:now, ...input,
          // Initial verification is enforced even if caller provided a value.
          isVerified:role !== Roles.PHARMACY, verifiedAt:null, verifiedBy:null };
        const record=await insert(name,doc,options);
        results.push(hydrate(name,record.doc));
      }
      return isArray ? results : results[0];
    },
    updateOne: (f,u,opts={}) => {
      rejectRoleMutation(u);
      return update(name,f,u,opts);
    },
    updateMany: (f,u,opts={}) => {
      rejectRoleMutation(u);
      return update(name,f,u,opts,true);
    },
    findOneAndUpdate: (f,u,opts={}) => {
      rejectRoleMutation(u);
      return findOneAndUpdate(name,f,u,opts);
    },
    replaceOne: () => { throw new Error('User replacement must not bypass immutable role policy.'); }

  };
};
const events = () => {
  const name='pharmacyverificationevents';
  return {
    collection: {
      ...collection(name),
      updateOne: () => { throw new Error('Pharmacy verification events are append-only.'); },
      updateMany: () => { throw new Error('Pharmacy verification events are append-only.'); },
      deleteOne: () => { throw new Error('Pharmacy verification events are append-only.'); },
      deleteMany: () => { throw new Error('Pharmacy verification events are append-only.'); }
    },
    find: (f={}) => new Query(name,f),
    findOne: (f={}) => new Query(name,f,{},'one'),
    create: async (payload, opts={}) => {
      const isArray=Array.isArray(payload);
      const items=isArray ? payload : [payload];
      const results=[];
      for (const item of items) {
        checkFields(item,EVENT_FIELDS);
        if (!item.pharmacyId || !item.changedBy || typeof item.previousValue !== 'boolean' ||
            typeof item.newValue !== 'boolean' || !item.reason) throw new Error('Invalid verification event');
        const result=await insert(name,{ changedAt:new Date(), ...item },opts);
        results.push(result.doc);
      }
      return isArray ? results : results[0];
    },
    updateOne: () => { throw new Error('Pharmacy verification events are append-only.'); },
    updateMany: () => { throw new Error('Pharmacy verification events are append-only.'); },
    deleteOne: () => { throw new Error('Pharmacy verification events are append-only.'); },
    deleteMany: () => { throw new Error('Pharmacy verification events are append-only.'); }
  };
};
module.exports = { hydrate, users: users(), events: events() };
