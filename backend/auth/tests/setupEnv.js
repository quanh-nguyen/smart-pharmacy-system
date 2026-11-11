process.env.NODE_ENV = 'test';
process.env.MYSQL_USER ||= 'test';
process.env.MYSQL_PASSWORD ||= 'test';
process.env.MYSQL_DATABASE ||= 'smart_medicine_test';
process.env.JWT_SECRET ||= 'test-secret-with-more-than-32-characters-long';
process.env.CORS_ORIGINS ||= 'http://localhost:5173';
process.env.BCRYPT_SALT_ROUNDS ||= '10';
