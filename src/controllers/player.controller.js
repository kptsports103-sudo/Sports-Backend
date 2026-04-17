const { getPlayerProfilePayload } = require('../services/playerProfile.service');

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

module.exports = {
  getPlayerProfile,
};
