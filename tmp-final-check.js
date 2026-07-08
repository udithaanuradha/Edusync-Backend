const { validateRole, validateUserCreation } = require('./src/utils/validators');

async function main() {
  console.log('VALIDATE_ROLE_MENTOR=', validateRole('mentor'));
  console.log('VALIDATE_ROLE_INDUSTRY_MENTOR=', validateRole('industry mentor'));
  console.log('VALIDATE_USER_CREATION_MENTOR=', validateUserCreation({
    firstName: 'Medi',
    lastName: 'Dara',
    email: 'medi@example.com',
    password: '123456',
    role: 'mentor'
  }));

  const res = await fetch('http://localhost:5000/api/users?role=mentor');
  const text = await res.text();
  console.log('USERS_ROLE_MENTOR_STATUS=', res.status);
  console.log('USERS_ROLE_MENTOR_BODY=', text);
}

main().catch((err) => {
  console.error('FINAL_CHECK_ERR=', err);
  process.exit(1);
});
