const MeetingReportModel = require('../models/meetingReportModel');

const createReport = (req, res) => {
  const { meeting_request_id, student_id, summary } = req.body;

  if (!meeting_request_id || !student_id || !summary?.trim()) {
    return res.status(400).json({ error: "meeting_request_id, student_id, and summary are required" });
  }

  // A report can only be written for a request that's actually approved,
  // and only by the student who made it — this also gives us the
  // supervisor_id/group_name to stamp the report with, straight from the
  // request, so the client can't spoof them.
  MeetingReportModel.getApprovedRequestForStudent(meeting_request_id, student_id, (findErr, request) => {
    if (findErr) {
      console.error("Error looking up meeting request for report:", findErr);
      return res.status(500).json({ error: "Failed to validate meeting request" });
    }
    if (!request) {
      return res.status(403).json({ error: "You can only write a report for your own approved meeting request." });
    }

    MeetingReportModel.createMeetingReport(
      {
        meeting_request_id,
        student_id,
        supervisor_id: request.supervisor_id,
        group_name: request.group_name,
        summary: summary.trim(),
      },
      (err, newReport) => {
        if (err) {
          console.error("Error creating meeting report:", err);
          return res.status(500).json({ error: "Failed to create meeting report" });
        }
        res.status(201).json(newReport);
      }
    );
  });
};

const getPendingReports = (req, res) => {
  const { supervisorId } = req.params;

  MeetingReportModel.getPendingReportsForSupervisor(supervisorId, (err, reports) => {
    if (err) {
      console.error("Error fetching meeting reports:", err);
      return res.status(500).json({ error: "Failed to fetch meeting reports" });
    }
    res.status(200).json(reports);
  });
};

const updateStatus = (req, res) => {
  const { id } = req.params;
  const { status, message } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  MeetingReportModel.updateReportStatus(id, status, message || null, (err) => {
    if (err) {
      console.error("Error updating meeting report status:", err);
      return res.status(500).json({ error: "Failed to update status" });
    }
    res.status(200).json({ success: true, message: `Status updated to ${status}` });
  });
};

const getReportsForStudent = (req, res) => {
  const { studentId } = req.params;

  MeetingReportModel.getReportsForStudent(studentId, (err, reports) => {
    if (err) {
      console.error("Error fetching meeting reports:", err);
      return res.status(500).json({ error: "Failed to fetch meeting reports" });
    }
    res.status(200).json(reports);
  });
};

// Powers the supervisor's "View History" panel — every meeting request +
// report tied to a group, across all its members.
const getGroupHistory = (req, res) => {
  const { groupName } = req.params;

  MeetingReportModel.getGroupHistory(decodeURIComponent(groupName), (err, history) => {
    if (err) {
      console.error("Error fetching group meeting history:", err);
      return res.status(500).json({ error: "Failed to fetch group meeting history" });
    }
    res.status(200).json(history);
  });
};

module.exports = {
  createReport,
  getPendingReports,
  updateStatus,
  getReportsForStudent,
  getGroupHistory
};
