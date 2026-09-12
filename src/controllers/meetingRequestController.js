const MeetingRequestModel = require('../models/meetingRequestModel');

const createRequest = (req, res) => {
  const { student_id, supervisor_id, group_name, topic, reason } = req.body;

  // preferred_date/preferred_time/end_time are optional — a student can
  // send a request without proposing a specific slot, leaving the
  // supervisor to set the actual date/time when they schedule it.
  if (!student_id || !supervisor_id || !group_name || !topic) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // A student can only request a meeting with a supervisor actually
  // assigned to their group — not any supervisor in the system.
  MeetingRequestModel.isSupervisorAssignedToStudent(student_id, supervisor_id, (assignErr, isAssigned) => {
    if (assignErr) {
      console.error("Error checking supervisor assignment:", assignErr);
      return res.status(500).json({ error: "Failed to validate supervisor assignment" });
    }
    if (!isAssigned) {
      return res.status(403).json({ error: "You can only request a meeting with your assigned supervisor." });
    }

    // Only one open (pending) request per supervisor at a time — once they
    // approve or reject it, the student is free to send another.
    MeetingRequestModel.hasPendingRequestForSupervisor(student_id, supervisor_id, (pendingErr, hasPending) => {
      if (pendingErr) {
        console.error("Error checking pending request:", pendingErr);
        return res.status(500).json({ error: "Failed to check pending requests" });
      }
      if (hasPending) {
        return res.status(409).json({ error: "You already have a pending request with this supervisor. Wait for a response, or delete it, before sending another." });
      }

      MeetingRequestModel.createMeetingRequest(req.body, (err, newRequest) => {
        if (err) {
          console.error("Error creating meeting request:", err);
          return res.status(500).json({ error: "Failed to create meeting request" });
        }
        res.status(201).json(newRequest);
      });
    });
  });
};

const getPendingRequests = (req, res) => {
  const { supervisorId } = req.params;
  
  MeetingRequestModel.getPendingRequestsForSupervisor(supervisorId, (err, requests) => {
    if (err) {
      console.error("Error fetching meeting requests:", err);
      return res.status(500).json({ error: "Failed to fetch meeting requests" });
    }
    res.status(200).json(requests);
  });
};

const updateStatus = (req, res) => {
  const { id } = req.params;
  const { status, message } = req.body; // 'approved' or 'rejected', and supervisor message

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  MeetingRequestModel.updateRequestStatus(id, status, message || null, (err) => {
    if (err) {
      console.error("Error updating meeting request status:", err);
      return res.status(500).json({ error: "Failed to update status" });
    }
    res.status(200).json({ success: true, message: `Status updated to ${status}` });
  });
};

const getRequestsForStudent = (req, res) => {
  const { studentId } = req.params;

  MeetingRequestModel.getRequestsForStudent(studentId, (err, requests) => {
    if (err) {
      console.error("Error fetching meeting requests:", err);
      return res.status(500).json({ error: "Failed to fetch meeting requests" });
    }
    res.status(200).json(requests);
  });
};

// Powers the "Supervisor" dropdown on the meeting request form — the
// student's actually-assigned supervisor(s) only.
const getAssignedSupervisors = (req, res) => {
  const { studentId } = req.params;

  MeetingRequestModel.getAssignedSupervisorsForStudent(studentId, (err, supervisors) => {
    if (err) {
      console.error("Error fetching assigned supervisors:", err);
      return res.status(500).json({ error: "Failed to fetch assigned supervisors" });
    }
    res.status(200).json(supervisors);
  });
};

// A student cancelling their own request — only while it's still pending
// (deletePendingRequest's WHERE clause enforces both the ownership and the
// status check, so this can't touch someone else's row or an
// already-responded-to one).
const deleteRequest = (req, res) => {
  const { id } = req.params;
  const studentId = req.body?.student_id || req.query.student_id;

  if (!studentId) {
    return res.status(400).json({ error: "student_id is required" });
  }

  MeetingRequestModel.deletePendingRequest(id, studentId, (err, deleted) => {
    if (err) {
      console.error("Error deleting meeting request:", err);
      return res.status(500).json({ error: "Failed to delete meeting request" });
    }
    if (!deleted) {
      return res.status(404).json({ error: "Request not found, not yours, or no longer pending." });
    }
    res.status(200).json({ success: true });
  });
};

module.exports = {
  createRequest,
  getPendingRequests,
  updateStatus,
  getRequestsForStudent,
  getAssignedSupervisors,
  deleteRequest
};
