// Standalone copy of the same parsing rule groupController.js uses for its
// own pending-requests view — kept as its own module (not imported from/into
// groupController.js) so the supervisor dashboard/progress controllers below
// can pick up a group's project title without adding any dependency on, or
// changing so much as one line of, groupController.js.
//
// The only place a group's project title exists today is as free text a
// student typed into their group_requests.request_message, e.g.
// "Project: hotel management system. Members: ...". There's no dedicated
// title column on project_groups.
const extractProjectName = (requestMessage) => {
  const text = String(requestMessage || '');
  const match = text.match(/Project:\s*([^\n.]+)/i);
  return match ? match[1].trim() : null;
};

module.exports = { extractProjectName };
