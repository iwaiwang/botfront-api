const {
  Conversations,
  Projects,
  NLUModels,
  Activity
} = require('../../models/models');

retreiveProjectsAndModelsIds = async function() {
  const projects = await Projects.find({})
    .select('nlu_models _id')
    .lean()
    .exec();
  projectAndModels = projects
    .filter(project => project.nlu_models !== undefined)
    .map(async project => {
      nluModels = await project.nlu_models.map(async projectNluModel => {
        nluModel = NLUModels.findOne({ _id: projectNluModel })
          .select('_id language')
          .lean()
          .exec();
        return nluModel;
      });
      nluModels = await Promise.all(nluModels);
      return { projectId: project._id, nluModels: nluModels };
    });
  return await Promise.all(projectAndModels);
};

inferModelId = function(projectId, language, projectsAndModels) {
  const project = projectsAndModels.find(
    projectAndModels => projectAndModels.projectId === projectId
  );
  const modelId = project.nluModels.find(
    nluModel => nluModel.language === language
  );
  if (modelId) return modelId._id;
  return undefined;
};

addParseDataToActivity = async function(conversation, oldestImportTimestamp) {
  const projectsAndModels = await retreiveProjectsAndModelsIds();
  let parseDataToAdd = [];
  let invalidParseData = [];
  const projectId = conversation.projectId;
  conversation.tracker.events.forEach(event => {
    if (
      event.parse_data !== undefined &&
      event.parse_data.language !== undefined &&
      event.parse_data.text !== '' &&
      event.timestamp > oldestImportTimestamp
    ) {
      const { intent, entities, text } = event.parse_data;
      const modelId = inferModelId(
        projectId,
        event.parse_data.language,
        projectsAndModels
      );
      if (modelId) {
        parseDataToAdd.push({
          modelId: modelId,
          text: text,
          intent: intent.name,
          entities,
          confidence: intent.confidence,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        invalidParseData.push(event.parse_data);
      }
    }
  });
  return { parseDataToAdd, invalidParseData };
};

createConversationsToAdd = function(conversations, env, projectsIds) {
  const toAdd = [];
  const notValids = [];
  conversations.forEach(conversation => {
    if (
      conversation._id !== undefined &&
      projectsIds.includes(conversation.projectId)
    ) {
      toAdd.push({
        ...conversation,
        env,
        updatedAt: new Date(),
        createdAt: new Date(conversation.createdAt)
      });
    } else {
      notValids.push(conversation);
    }
  });

  return { toAdd, notValids };
};

exports.importConversation = async function(req, res) {
  const { conversations, processNlu } = req.body;
  const { env } = req.params;
  // checks for parameters correctness
  if (!['production', 'staging', 'developement'].includes(env)) {
    return res.status(400).json({
      error: 'environement should be one of: production, staging, developement'
    });
  }
  if (conversations === undefined || processNlu === undefined) {
    return res.status(400).json({
      error: 'the body is missing conversations or processNlu, or both'
    });
  }
  if (!Array.isArray(conversations)) {
    return res.status(400).json({ error: 'conversations should be an array' });
  }

  if (typeof processNlu !== 'boolean') {
    return res.status(400).json({ error: 'processNlu should be an boolean' });
  }

  let projectIds = await Projects.find({})
    .select('_id')
    .exec();
  projectIds = projectIds.map(project => project._id);
  oldestImport = await getOldestTimeStamp(env);

  const { toAdd, notValids } = createConversationsToAdd(
    conversations,
    env,
    projectIds
  );

  //delacred out of the forEach Block so it can be accessed later
  const invalidParseDatas = [];
  // add each prepared conversatin to the db, a promise all is used to ensure that all data is added before checking for errors
  errors = [];
  await Promise.all(
    toAdd.map(async conversation => {
      Conversations.updateOne(
        { _id: conversation._id },
        conversation,
        { upsert: true },
        function(err) {
          if (err) errors.push(err);
        }
      );
      if (processNlu) {
        const {
          parseDataToAdd,
          invalidParseData
        } = await addParseDataToActivity(conversation, oldestImport);
        if (parseDataToAdd && parseDataToAdd.length > 0) {
          await Activity.insertMany(parseDataToAdd, function(err) {
            if (err) errors.push(err);
          });
        }
        if (invalidParseData && invalidParseData.length > 0)
          invalidParseDatas.push(invalidParseData);
      }
    })
  );

  if (errors.length > 0) {
    return res.status(500).json(errors);
  }

  //create a report of the errors, if any
  const formatsError = {};
  if (notValids && notValids.length > 0) {
    formatsError.messageConversation =
      'some conversation were not added, either the _id is missing or projectId does not exist';
    formatsError.notValids = notValids;
  }
  if (invalidParseDatas.length > 0) {
    formatsError.messageParseData =
      'Some parseData have not been added to activity, the corresponding models could not be found ';
    formatsError.invalidParseDatas = invalidParseDatas;
  }
  //object not empty
  if (Object.keys(formatsError).length !== 0) {
    return res.status(206).json(formatsError);
  }

  return res
    .status(200)
    .json({ message: 'successfuly imported all conversations' });
};

getOldestTimeStamp = async function(env) {
  const lastestAddition = await Conversations.findOne({ env: env })
    .select('updatedAt')
    .sort('-updatedAt')
    .lean()
    .exec();
  if (lastestAddition) return Math.floor(lastestAddition.updatedAt / 1000);
  return 0;
};

exports.lastestImport = async function(req, res) {
  const { env } = req.params;
  // checks for parameters correctness
  if (!['production', 'staging', 'developement'].includes(env)) {
    return res.status(400).json({
      error: 'environement should be one of: production, staging, developement'
    });
  }
  const oldest = await getOldestTimeStamp(env);
  return res.status(200).json({ timestamp: oldest });
};
