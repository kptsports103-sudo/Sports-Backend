const GroupResult = require('../models/groupResult.model');

const normalizeGroupPayload = (raw = {}) => {
  const data = { ...raw };
  const members = Array.isArray(data.members) ? data.members : [];

  const normalizedMembers = members
    .map((member) => {
      if (!member || typeof member !== 'object') return null;
      const legacyId = String(member.playerId || '').trim();
      const masterId = String(member.playerMasterId || legacyId || '').trim();

      return {
        ...member,
        playerMasterId: masterId || undefined,
        playerId: legacyId || undefined,
        branch: String(member.branch || '').trim()
      };
    })
    .filter(Boolean);

  if (normalizedMembers.length) {
    data.members = normalizedMembers;
  }

  const incomingMasterIds = Array.isArray(data.memberMasterIds) ? data.memberMasterIds : [];
  const derivedMasterIds = normalizedMembers
    .map((m) => String(m.playerMasterId || '').trim())
    .filter(Boolean);
  data.memberMasterIds = Array.from(new Set([...incomingMasterIds, ...derivedMasterIds]));

  return data;
};

const getGroupResults = async (req, res) => {
  try {
    const groupResults = await GroupResult.find().sort({ year: -1 });
    res.json(groupResults);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const createGroupResult = async (req, res) => {
  try {
    const data = normalizeGroupPayload(req.body);
    if (data.imageUrl === '' || !data.imageUrl?.trim()) {
      data.imageUrl = null;
    }
    const groupResult = new GroupResult(data);
    await groupResult.save();
    res.status(201).json(groupResult);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const updateGroupResult = async (req, res) => {
  try {
    const updateData = normalizeGroupPayload(req.body);
    if (updateData.imageUrl === '' || !updateData.imageUrl?.trim()) {
      updateData.imageUrl = null;
    }

    const groupResult = await GroupResult.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!groupResult) {
      return res.status(404).json({ message: 'Group result not found' });
    }

    res.json(groupResult);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteGroupResult = async (req, res) => {
  try {
    const groupResult = await GroupResult.findByIdAndDelete(req.params.id);

    if (!groupResult) {
      return res.status(404).json({ message: 'Group result not found' });
    }

    res.json({ message: 'Group result deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getGroupResults,
  createGroupResult,
  updateGroupResult,
  deleteGroupResult,
};
