# Validation Utility Documentation

## Overview

The validation utility (`src/utils/validators.js`) provides a comprehensive, reusable validation layer for your Node.js/Express backend. It implements a three-layer validation pattern:

1. **Frontend**: React form validation
2. **Backend**: Express route validation (this utility)
3. **Database**: MySQL constraints and uniqueness checks

## Features

### Strict Role Whitelist
Only these 5 roles are allowed:
- `student`
- `supervisor`
- `coordinator`
- `admin`
- `industry mentor`

Any attempt to create a user with an invalid role will be rejected with a detailed error message.

## API Reference

### Constants

```javascript
const { VALID_ROLES } = require('./src/utils/validators');
// Returns: ['student', 'supervisor', 'coordinator', 'admin', 'industry mentor']
```

### Functions

#### `validateRole(role: string): boolean`
Checks if a role is in the allowed roles list.

**Example:**
```javascript
const { validateRole } = require('./src/utils/validators');
validateRole('student')        // true
validateRole('admin')          // true
validateRole('superuser')      // false
```

#### `validateEmail(email: string): boolean`
Validates email format using regex pattern.

**Example:**
```javascript
const { validateEmail } = require('./src/utils/validators');
validateEmail('user@example.com')  // true
validateEmail('invalid-email')     // false
```

#### `validatePassword(password: string): boolean`
Validates password (minimum 6 characters).

**Example:**
```javascript
const { validatePassword } = require('./src/utils/validators');
validatePassword('securepass123')  // true
validatePassword('short')          // false
```

#### `validateName(name: string): boolean`
Validates name fields (minimum 2 characters, letters/spaces/hyphens/apostrophes only).

**Example:**
```javascript
const { validateName } = require('./src/utils/validators');
validateName('John')       // true
validateName('O\'Brien')   // true
validateName('Mary-Jane')  // true
validateName('X')          // false
```

#### `validateUniversityId(universityId: string): boolean`
Validates university ID (alphanumeric, minimum 3 characters).

**Example:**
```javascript
const { validateUniversityId } = require('./src/utils/validators');
validateUniversityId('STU2024001')  // true
validateUniversityId('AB')          // false
```

#### `validateUserCreation(userData: Object): {valid: boolean, errors: string[]}`
Comprehensive validation for user signup/creation. Accumulates all validation errors.

**Parameters:**
```javascript
{
  firstName: string,      // Required
  lastName: string,       // Required
  email: string,          // Required
  password: string,       // Required (min 6 chars)
  role: string,           // Required (must be in VALID_ROLES)
  universityId: string    // Required for students, optional for others
}
```

**Returns:**
```javascript
{
  valid: boolean,        // true if all validations pass
  errors: string[]       // Array of error messages (empty if valid)
}
```

**Examples:**

```javascript
const { validateUserCreation } = require('./src/utils/validators');

// Valid student
const result1 = validateUserCreation({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@university.edu',
  password: 'securepass123',
  role: 'student',
  universityId: 'STU2024001'
});
// Returns: { valid: true, errors: [] }

// Invalid role
const result2 = validateUserCreation({
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@university.edu',
  password: 'securepass123',
  role: 'superuser',  // INVALID
  universityId: 'STU2024002'
});
// Returns: { valid: false, errors: ['Invalid role. Allowed roles are: student, supervisor, coordinator, admin, industry mentor'] }

// Student missing university ID
const result3 = validateUserCreation({
  firstName: 'Bob',
  lastName: 'Johnson',
  email: 'bob@university.edu',
  password: 'securepass123',
  role: 'student'
  // Missing universityId
});
// Returns: { valid: false, errors: ['University ID is required for students'] }

// Multiple errors
const result4 = validateUserCreation({
  firstName: 'X',           // Too short
  lastName: '',             // Missing
  email: 'invalid',         // Invalid format
  password: '123',          // Too short
  role: 'invalid_role'      // Invalid role
});
// Returns: { valid: false, errors: [
//   'First name must be at least 2 characters...',
//   'Last name is required',
//   'Invalid email format',
//   'Password must be at least 6 characters long',
//   'Invalid role. Allowed roles are: ...'
// ]}
```

#### `validateUserUpdate(userData: Object): {valid: boolean, errors: string[]}`
Validates partial user data for update operations (all fields optional).

**Example:**
```javascript
const { validateUserUpdate } = require('./src/utils/validators');

const result = validateUserUpdate({
  email: 'newemail@university.edu',
  role: 'supervisor'
});
// Returns: { valid: true, errors: [] } if all provided fields are valid
```

## Integration Examples

### In Express Routes

```javascript
const express = require('express');
const { validateUserCreation } = require('./src/utils/validators');

const app = express();
app.use(express.json());

// User signup route
app.post('/api/signup', (req, res) => {
  const validation = validateUserCreation(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.errors
    });
  }

  // Proceed with user creation
  // INSERT INTO database...
});

// User update route
app.put('/api/users/:id', (req, res) => {
  const { validateUserUpdate } = require('./src/utils/validators');
  const validation = validateUserUpdate(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.errors
    });
  }

  // Proceed with user update
});
```

### In Middleware

```javascript
const { validateUserCreation } = require('./src/utils/validators');

// Reusable validation middleware
const validateUserSignup = (req, res, next) => {
  const validation = validateUserCreation(req.body);

  if (!validation.valid) {
    return res.status(400).json({
      error: 'Validation failed',
      details: validation.errors
    });
  }

  next();
};

// Use in routes
app.post('/api/signup', validateUserSignup, createUserController);
```

## Current Implementation Status

✅ **Completed:**
- Created `src/utils/validators.js` with all validation functions
- Integrated into `/api/signup` route (index.js)
- Strict role whitelist enforced
- Comprehensive field validation
- Error accumulation (returns all errors, not just first)
- Tests pass successfully

🔄 **Can Apply To:**
- Any user creation endpoint
- User update/edit endpoints
- Admin user management routes
- Role-based access control routes
- Form validation in frontend

## Testing

Run the test file to verify all validators work correctly:

```bash
cd Edusync-Backend
node test-validators.js
```

Expected output shows:
- ✓ Valid roles are accepted
- ✗ Invalid roles are rejected
- ✓ Valid emails pass validation
- ✗ Invalid emails fail
- ✓ Student requires university ID
- ✓ Other roles don't require university ID
- ✓ Multiple errors are accumulated

## Security Benefits

1. **Role Enforcement**: Only 5 allowed roles - prevents role injection attacks
2. **Format Validation**: Email, password, and ID validation prevent malformed data
3. **Type Checking**: Ensures data types are correct before database insertion
4. **Consistency**: Same validation rules applied everywhere
5. **Error Messages**: Detailed, actionable feedback for developers and API consumers

## Next Steps

1. ✅ Validation utility created and tested
2. ✅ Integrated into `/api/signup` route
3. 🔄 Apply to other user-related routes
4. 🔄 Add database-level CHECK constraints
5. 🔄 Add frontend validation (React form)
