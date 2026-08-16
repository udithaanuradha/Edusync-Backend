const calculateSubmissionStatus = (submittedAt, deadline) => {
  if (!submittedAt || !deadline) return 'On Time';
  return new Date(submittedAt) <= new Date(deadline) ? 'On Time' : 'Late';
};

const getDaysRemaining = (deadline) => {
  if (!deadline) return null;
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const diffMs = deadlineDate.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
};

module.exports = { calculateSubmissionStatus, getDaysRemaining };
