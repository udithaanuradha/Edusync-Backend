/**
 * Validation Utilities for Edusync Backend
 * Implements strict role validation and user data validation
 * Three-layer validation pattern: Frontend → Backend → Database
 */

// Strict whitelist of valid user roles
const VALID_ROLES = ['student', 'supervisor', 'coordinator', 'admin', 'industry mentor','lecturer'];

// Strict whitelist of valid student departments (this is the same 3-option
// "Degree Program" already collected at signup and stored in the
// `academic_unit` column — group-formation department scoping reuses it
// rather than adding a second, separate field). Note: `academic_unit` is
// also used to store a lecturer's own department (IT/IDS/CM), which is a
// completely different value domain — this whitelist must only ever be
// applied when role === 'student'.
const VALID_DEPARTMENTS = ['AI', 'IT', 'ITM'];

/**
 * Validates a student department/degree-program code against the whitelist.
 * @param {string} department - The department code to validate
 * @returns {boolean} - True if department is valid, false otherwise
 */
function validateDepartment(department) {
  if (!department || typeof department !== 'string') {
    return false;
  }
  return VALID_DEPARTMENTS.includes(department.toUpperCase().trim());
}

/**
 * Validates if a role string is in the allowed roles list
 * @param {string} role - The role to validate
 * @returns {boolean} - True if role is valid, false otherwise
 */
function validateRole(role) {
  if (!role || typeof role !== 'string') {
    return false;
  }
  return VALID_ROLES.includes(role.toLowerCase().trim());
}

/**
 * Validates email format using regex pattern with proper domain and TLD
 * @param {string} email - The email to validate
 * @returns {boolean} - True if email format is valid, false otherwise
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates phone number format: exactly 10 digits, letters rejected
 * @param {string} phone - The phone number to validate
 * @returns {boolean} - True if phone is valid (or empty if optional)
 */
function validatePhone(phone) {
  if (!phone || typeof phone !== 'string') {
    return true; // Optional if not provided
  }
  const trimmed = phone.trim();
  if (trimmed === '') return true;
  return /^\d{10}$/.test(trimmed);
}

/**
 * Validates password strength: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special character
 * @param {string} password - The password to validate
 * @returns {boolean} - True if password meets all requirements, false otherwise
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }
  const minLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*(),.?":{}|<>_~`+=\\/\-[\]]/.test(password);

  return minLength && hasUpper && hasLower && hasNumber && hasSpecial;
}

/**
 * Validates a name field (firstName or lastName)
 * @param {string} name - The name to validate
 * @returns {boolean} - True if name is valid, false otherwise
 */
function validateName(name) {
  if (!name || typeof name !== 'string') {
    return false;
  }
  // Name must be at least 2 characters and contain only letters, spaces, hyphens, apostrophes
  const trimmed = name.trim();
  return trimmed.length >= 2 && /^[a-zA-Z\s'-]+$/.test(trimmed);
}

/**
 * Validates university ID format: 6 numbers followed by 1 letter (e.g., 235020G)
 * @param {string} universityId - The university ID to validate
 * @returns {boolean} - True if universityId is valid, false otherwise
 */
function validateUniversityId(universityId) {
  if (!universityId || typeof universityId !== 'string') {
    return false;
  }
  const trimmed = universityId.trim();
  return /^\d{6}[a-zA-Z]$/.test(trimmed);
}

/**
 * Comprehensive validation for user creation/signup
 * Validates all required fields and applies appropriate constraints per role
 * @param {Object} userData - The user data object to validate
 * @param {string} userData.firstName - User's first name (required)
 * @param {string} userData.lastName - User's last name (required)
 * @param {string} userData.email - User's email (required, must be unique in database)
 * @param {string} [userData.phone] - User's phone (must be 10 digits if provided)
 * @param {string} userData.password - User's password (required, min 8 chars with complexity)
 * @param {string} userData.role - User's role (required, must be in VALID_ROLES)
 * @param {string} userData.universityId - University ID (required for students, 6 digits + 1 letter)
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateUserCreation(userData) {
  const errors = [];

  if (!userData || typeof userData !== 'object') {
    return {
      valid: false,
      errors: ['Invalid input: userData must be an object']
    };
  }

  // Validate firstName
  if (!userData.firstName) {
    errors.push('First name is required');
  } else if (!validateName(userData.firstName)) {
    errors.push('First name must be at least 2 characters and contain only letters, spaces, hyphens, or apostrophes');
  }

  // Validate lastName
  if (!userData.lastName) {
    errors.push('Last name is required');
  } else if (!validateName(userData.lastName)) {
    errors.push('Last name must be at least 2 characters and contain only letters, spaces, hyphens, or apostrophes');
  }

  // Validate email
  if (!userData.email) {
    errors.push('Email is required');
  } else if (!validateEmail(userData.email)) {
    errors.push('Please enter a valid email address (e.g., name@gmail.com or name.23@uom.lk)');
  }

  // Validate phone
  if (userData.phone && !validatePhone(userData.phone)) {
    errors.push('Phone number must contain exactly 10 digits (e.g., 07XXXXXXXX)');
  }

  // Validate password
  if (!userData.password) {
    errors.push('Password is required');
  } else if (!validatePassword(userData.password)) {
    errors.push('Password must be at least 8 characters and include uppercase, lowercase, number, and special character');
  }

  // Validate role (STRICT - must be in whitelist)
  if (!userData.role) {
    errors.push('Role is required');
  } else if (!validateRole(userData.role)) {
    errors.push(`Invalid role. Allowed roles are: ${VALID_ROLES.join(', ')}`);
  }

  // Validate universityId for students
  if (userData.role && validateRole(userData.role) && userData.role.toLowerCase() === 'student') {
    if (!userData.universityId) {
      errors.push('University ID is required for students');
    } else if (!validateUniversityId(userData.universityId)) {
      errors.push('University ID must contain 6 numbers followed by 1 letter');
    }
  }

  // Validate department for students (STRICT - must be in whitelist)
  if (userData.role && validateRole(userData.role) && userData.role.toLowerCase() === 'student') {
    if (!userData.department) {
      errors.push('Department is required for students');
    } else if (!validateDepartment(userData.department)) {
      errors.push(`Invalid department. Allowed departments are: ${VALID_DEPARTMENTS.join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Validates user update data
 * Similar to validateUserCreation but all fields are optional (for PATCH/PUT operations)
 * @param {Object} userData - The partial user data object to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateUserUpdate(userData) {
  const errors = [];

  if (!userData || typeof userData !== 'object') {
    return {
      valid: false,
      errors: ['Invalid input: userData must be an object']
    };
  }

  // All validations are optional, but if provided, must be valid

  if (userData.firstName !== undefined) {
    if (!validateName(userData.firstName)) {
      errors.push('First name must be at least 2 characters and contain only letters, spaces, hyphens, or apostrophes');
    }
  }

  if (userData.lastName !== undefined) {
    if (!validateName(userData.lastName)) {
      errors.push('Last name must be at least 2 characters and contain only letters, spaces, hyphens, or apostrophes');
    }
  }

  if (userData.email !== undefined) {
    if (!validateEmail(userData.email)) {
      errors.push('Invalid email format');
    }
  }

  if (userData.password !== undefined) {
    if (!validatePassword(userData.password)) {
      errors.push('Password must be at least 6 characters long');
    }
  }

  if (userData.role !== undefined) {
    if (!validateRole(userData.role)) {
      errors.push(`Invalid role. Allowed roles are: ${VALID_ROLES.join(', ')}`);
    }
  }

  if (userData.universityId !== undefined) {
    if (!validateUniversityId(userData.universityId)) {
      errors.push('Invalid University ID format (must be alphanumeric, at least 3 characters)');
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}

/**
 * Exports all validation functions and constants
 */
module.exports = {
  VALID_ROLES,
  VALID_DEPARTMENTS,
  validateRole,
  validateEmail,
  validatePassword,
  validateName,
  validateUniversityId,
  validateDepartment,
  validateUserCreation,
  validateUserUpdate
};
