const { checkApiKeyAgainstProject } = require('../server/utils');
const db = require('monk')(process.env.MONGO_URL);
const Model = require('../server/nlu_model/model');
const { logUtterance } = require('../server/utterance/utterance.controller');

exports.getSenderEventCount = function(req, res) {
    const dialogues = db.get('conversations', { castIds: false });
    const { project_id: projectId, sender_id: senderId } = req.params;
    checkApiKeyAgainstProject(projectId, req)
        .then(() => dialogues.findOne({ _id: senderId }))
        .then(doc => {
            if (!doc) {
                return res.status(200).json(null);
            }

            if (doc.projectId !== req.params.project_id) {
                return res.status(400).json({
                    error: 'Project ID does not match the requested tracker.',
                });
            }

            const tracker = doc.tracker;
            const start = req.params.event_count
                ? tracker.events.length - Number(req.params.event_count)
                : 0;
            tracker.events = tracker.events.slice(start >= 0 ? start : 0);

            res.status(200).json(tracker);
        })
        .catch(error => res.status(error.code || 500).json(error));
};

exports.insertConversation = function(req, res) {
    const { project_id: projectId, sender_id: senderId } = req.params;
    checkApiKeyAgainstProject(projectId, req)
        .then(() => {
            const dialogues = db.get('conversations', {
                castIds: false,
            });
            return dialogues
                .insert({
                    _id: senderId,
                    tracker: req.body,
                    status: 'new',
                    projectId: projectId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
                .then(() => res.sendStatus(200))
                .catch(error => {
                    throw { code: 500, message: error };
                });
        })
        .catch(error => res.status(error.code || 500).json(error));
};

exports.updateConversation = async function(req, res) {
    const { project_id: projectId, sender_id: senderId } = req.params;

    try {
        const userUtterances = req.body.events
            .filter(event => event.event === 'user' && event.text.indexOf('/') !== 0);
        if (userUtterances.length) { // there should only be one event here, really
            const { language } = userUtterances[0].parse_data;
            Model.aggregate()
                .lookup({
                    from: 'projects',
                    localField: '_id',
                    foreignField: 'nlu_models',
                    as: 'project',
                })
                .match({ language, 'project.0._id': projectId })
                .exec((err, aggr) => {
                    if (err) throw new Error(err);
                    if (!aggr.length) throw new Error('Could not find model to log utterance to.')
                    userUtterances.forEach(u => logUtterance(
                        aggr[0]._id,
                        u.parse_data,
                        (_u, e) => e && console.log('Logging failed: ', e),
                    ));
                })
        }
    } catch (e) {
        console.log('Logging failed: ', e)
    }
    checkApiKeyAgainstProject(projectId, req)
        .then(() => {
            const tracker = req.body;
            const setTracker = {};
            Object.keys(tracker).forEach(key => {
                if (key !== 'events') {
                    setTracker[`tracker.${key}`] = tracker[key];
                }
            });

            const dialogues = db.get('conversations', {
                castIds: false,
            });
            dialogues
                .update(
                    { _id: senderId },
                    {
                        $push: {
                            'tracker.events': { $each: req.body.events },
                        },
                        $set: {
                            ...setTracker,
                            updatedAt: new Date(),
                        },
                    },
                )
                .then(function(results) {
                    if (results.n > 0) {
                        return res.sendStatus(200);
                    } else {
                        // Insert if none found
                        dialogues
                            .insert({
                                _id: senderId,
                                tracker: req.body,
                                status: 'new',
                                projectId: projectId,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            })
                            .then(() => res.sendStatus(200))
                            .catch(error => res.status(400).json(error));
                    }
                })
                .catch(error => res.status(400).json(error));
        })
        .catch(error => res.status(error.code || 500).json(error));
};
