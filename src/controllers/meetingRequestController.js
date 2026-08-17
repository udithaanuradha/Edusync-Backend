const MeetingRequestModel = require('../models/meetingRequestModel');

const createRequest = (req, res) => {
  const { student_id, supervisor_id, group_name, topic, preferred_date, preferred_time, reason } = req.body;
  
  if (!student_id || !supervisor_id || !group_name || !topic || !preferred_date || !preferred_time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  MeetingRequestModel.createMeetingRequest(req.body, (err, newRequest) => {
    if (err) {
      console.error("Error creating meeting request:", err);
      return res.status(500).json({ error: "Failed to create meeting request" });
    }
    res.status(201).json(newRequest);
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
  const { status } = req.body; // 'approved' or 'rejected'

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  MeetingRequestModel.updateRequestStatus(id, status, (err) => {
    if (err) {
      console.error("Error updating meeting request status:", err);
      return res.status(500).json({ error: "Failed to update status" });
    }
    res.status(200).json({ success: true, message: `Status updated to ${status}` });
  });
};

module.exports = {
  createRequest,
  getPendingRequests,
  updateStatus
};
