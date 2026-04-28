/**
 * Test file for validation utilities
 * Run with: node test-validators.js
 */

const {
  validateRole,
  validateEmail,
  validatePassword,
  validateUserCreation,
  VALID_ROLES
} = require("./src/utils/validators");

console.log("=== Validation Utility Tests ===\n");

console.log("Valid roles:", VALID_ROLES);
console.log("\n");

// Test 1: Role validation
console.log("--- Test 1: Role Validation ---");
console.log("✓ validateRole('student'):", validateRole('student'));
console.log("✓ validateRole('admin'):", validateRole('admin'));
console.log("✗ validateRole('superuser'):", validateRole('superuser'));
console.log("✗ validateRole(null):", validateRole(null));
console.log("\n");

// Test 2: Email validation
console.log("--- Test 2: Email Validation ---");
console.log("✓ validateEmail('user@example.com'):", validateEmail('user@example.com'));
console.log("✗ validateEmail('invalid-email'):", validateEmail('invalid-email'));
console.log("✗ validateEmail(''):", validateEmail(''));
console.log("\n");

// Test 3: Password validation
console.log("--- Test 3: Password Validation ---");
console.log("✓ validatePassword('password123'):", validatePassword('password123'));
console.log("✗ validatePassword('short'):", validatePassword('short'));
console.log("✗ validatePassword(''):", validatePassword(''));
console.log("\n");

// Test 4: Valid user creation
console.log("--- Test 4: Valid User Creation (Student) ---");
const validStudent = {
  firstName: "John",
  lastName: "Doe",
  email: "john@university.edu",
  password: "securepass123",
  role: "student",
  universityId: "STU2024001"
};
const result1 = validateUserCreation(validStudent);
console.log("Result:", result1);
console.log("\n");

// Test 5: Invalid role in user creation
console.log("--- Test 5: Invalid Role (Should Fail) ---");
const invalidRole = {
  firstName: "Jane",
  lastName: "Smith",
  email: "jane@university.edu",
  password: "securepass123",
  role: "superuser",
  universityId: "STU2024002"
};
const result2 = validateUserCreation(invalidRole);
console.log("Result:", result2);
console.log("\n");

// Test 6: Student without university ID
console.log("--- Test 6: Student Missing University ID (Should Fail) ---");
const studentNoId = {
  firstName: "Bob",
  lastName: "Johnson",
  email: "bob@university.edu",
  password: "securepass123",
  role: "student"
};
const result3 = validateUserCreation(studentNoId);
console.log("Result:", result3);
console.log("\n");

// Test 7: Valid coordinator (no university ID needed)
console.log("--- Test 7: Valid Coordinator (No University ID) ---");
const validCoordinator = {
  firstName: "Dr",
  lastName: "Wilson",
  email: "wilson@university.edu",
  password: "securepass123",
  role: "coordinator"
};
const result4 = validateUserCreation(validCoordinator);
console.log("Result:", result4);
console.log("\n");

// Test 8: Multiple validation errors
console.log("--- Test 8: Multiple Validation Errors ---");
const multipleErrors = {
  firstName: "X",
  lastName: "",
  email: "invalid",
  password: "123",
  role: "invalid_role"
};
const result5 = validateUserCreation(multipleErrors);
console.log("Result:", result5);
console.log("\n");

console.log("=== All Tests Complete ===");
