'use strict';
const {initializeSchema}=require('../server');
initializeSchema().then(()=>console.log('MySQL DEMO schema created/verified.')).catch(e=>{console.error(e.message);process.exitCode=1;});
