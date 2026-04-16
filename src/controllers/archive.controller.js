const { getArchivePayload } = require('../services/archive.service');

const handleArchiveRequest = async (req, res) => {
  try {
    const payload = await getArchivePayload(req.params?.year);
    res.json(payload);
  } catch (error) {
    console.error('Failed to load archive payload:', error);
    res.status(500).json({
      message: 'Failed to load archive data',
    });
  }
};

module.exports = {
  getArchiveOverview: handleArchiveRequest,
  getArchiveByYear: handleArchiveRequest,
};
