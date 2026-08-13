import { validateUpdateApplicationStatus } from '../middleware/validationMiddleware.js';

function run(middleware, body) {
  return new Promise((resolve) => {
    const req = { body, query: {} };
    const res = { statusCode: 200 };
    const next = (err) => resolve(err ? err.message : 'OK');
    middleware[0].run(req).then(() => middleware[1].run(req).then(() => {
      if (req._validationErrors && req._validationErrors.length) {
        resolve('FAIL: ' + req._validationErrors.map(e => e.msg).join(', '));
        return;
      }
      resolve('VALID, status now: ' + req.body.status);
    }));
  });
}

console.log('Approved  ->', await run(validateUpdateApplicationStatus, { status: 'Approved', notes: 'x' }));
console.log('FLAGGED   ->', await run(validateUpdateApplicationStatus, { status: 'FLAGGED', notes: 'x' }));
console.log('rejected  ->', await run(validateUpdateApplicationStatus, { status: 'rejected', notes: 'x' }));
console.log('badvalue  ->', await run(validateUpdateApplicationStatus, { status: 'nonsense', notes: 'x' }));
