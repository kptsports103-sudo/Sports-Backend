const { getPlayerDirectoryPayload, getPlayerProfilePayload } = require('../services/playerProfile.service');
const {
  listPlayerChangeRequests,
  getPlayerChangeRequestById,
  approvePlayerChangeRequest,
  rejectPlayerChangeRequest,
} = require('../services/playerApproval.service');

const getPlayerDirectory = async (req, res) => {
  try {
    const payload = await getPlayerDirectoryPayload(req.query);
    return res.json(payload);
  } catch (error) {
    console.error('Error fetching player directory:', error);
    return res.status(500).json({
      message: 'Failed to load player directory.',
    });
  }
};

const getPlayerProfile = async (req, res) => {
  try {
    const payload = await getPlayerProfilePayload(req.params.playerId);

    if (!payload) {
      return res.status(404).json({
        message: 'Player profile not found.',
      });
    }

    return res.json(payload);
  } catch (error) {
    console.error('Error fetching player profile:', error);
    return res.status(500).json({
      message: 'Failed to load player profile.',
    });
  }
};

const getPlayerApprovalRequests = async (req, res) => {
  try {
    const payload = await listPlayerChangeRequests({
      actor: req.user,
      query: req.query,
    });
    return res.json(payload);
  } catch (error) {
    console.error('Error fetching player approval requests:', error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || 'Failed to load player approval requests.',
    });
  }
};

const getPlayerApprovalRequest = async (req, res) => {
  try {
    const payload = await getPlayerChangeRequestById({
      actor: req.user,
      requestId: req.params.requestId,
    });
    return res.json(payload);
  } catch (error) {
    console.error('Error fetching player approval request:', error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || 'Failed to load player approval request.',
    });
  }
};

const approvePlayerApprovalRequest = async (req, res) => {
  try {
    const payload = await approvePlayerChangeRequest({
      actor: req.user,
      requestId: req.params.requestId,
      reviewNote: req.body?.reviewNote,
    });
    return res.json({
      message: 'Player change request approved successfully.',
      ...payload,
    });
  } catch (error) {
    console.error('Error approving player approval request:', error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || 'Failed to approve player change request.',
    });
  }
};

const rejectPlayerApprovalRequest = async (req, res) => {
  try {
    const payload = await rejectPlayerChangeRequest({
      actor: req.user,
      requestId: req.params.requestId,
      reviewNote: req.body?.reviewNote,
    });
    return res.json({
      message: 'Player change request rejected successfully.',
      ...payload,
    });
  } catch (error) {
    console.error('Error rejecting player approval request:', error);
    return res.status(error?.statusCode || 500).json({
      message: error?.message || 'Failed to reject player change request.',
    });
  }
};

module.exports = {
  getPlayerDirectory,
  getPlayerProfile,
  getPlayerApprovalRequests,
  getPlayerApprovalRequest,
  approvePlayerApprovalRequest,
  rejectPlayerApprovalRequest,
};
