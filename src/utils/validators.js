/**
 * Validation Utilities for Edusync Backend
 * Implements strict role validation and user data validation
 * Three-layer validation pattern: Frontend → Backend → Database
 */

// Strict whitelist of valid user roles
const VALID_ROLES = ['student', 'supervisor', 'coordinator', 'admin', 'industry mentor'];

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
 * Validates email format using a basic regex pattern
 * @param {string} email - The email to validate
 * @returns {boolean} - True if email format is valid, false otherwise
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return false;
  }
  // Basic email validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates password strength
 * @param {string} password - The password to validate
 * @returns {boolean} - True if password meets minimum requirements, false otherwise
 */
function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return false;
  }
  // Minimum 6 characters
  return password.length >= 6;
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
 * Validates university ID format (for students)
 * @param {string} universityId - The university ID to validate
 * @returns {boolean} - True if universityId is valid, false otherwise
 */
function validateUniversityId(universityId) {
  if (!universityId || typeof universityId !== 'string') {
    return false;
  }
  // University ID should be alphanumeric, at least 3 characters
  const trimmed = universityId.trim();
  return trimmed.length >= 3 && /^[a-zA-Z0-9]+$/.test(trimmed);
}

/**
 * Comprehensive validation for user creation/signup
 * Validates all required fields and applies appropriate constraints per role
 * @param {Object} userData - The user data object to validate
 * @param {string} userData.firstName - User's first name (required)
 * @param {string} userData.lastName - User's last name (required)
 * @param {string} userData.email - User's email (required, must be unique in database)
 * @param {string} userData.password - User's password (required, min 6 chars)
 * @param {string} userData.role - User's role (required, must be in VALID_ROLES)
 * @param {string} userData.universityId - University ID (required for students, optional for others)
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
    errors.push('Invalid email format');
  }

  // Validate password
  if (!userData.password) {
    errors.push('Password is required');
  } else if (!validatePassword(userData.password)) {
    errors.push('Password must be at least 6 characters long');
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
      errors.push('Invalid University ID format (must be alphanumeric, at least 3 characters)');
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
  validateRole,
  validateEmail,
  validatePassword,
  validateName,
  validateUniversityId,
  validateUserCreation,
  validateUserUpdate
};
