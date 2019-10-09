const request = require('supertest-as-promised');
const httpStatus = require('http-status');
const chai = require('chai');
const expect = chai.expect;
const app = require('../../app');
chai.config.includeStack = true;
const fs = require('fs');
const {
  Projects,
  NLUModels,
  Conversations,
  Activity
} = require('../../models/models');

const conversationsToImport = JSON.parse(
  fs.readFileSync(__dirname + '/test_data/conversationsToImport.json', 'utf8')
);

function dateParser(key, value) {
  if (key === 'updatedAt' || key === 'createdAt') {
    return new Date(value * 1000);
  }
  return value;
}
before(function(done) {
  const projectsFile = __dirname + '/test_data/projects.json';
  const modelsFile = __dirname + '/test_data/nluModels.json';
  const conversationFile = __dirname + '/test_data/conversations.json';
  const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
  const models = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
  const conversation = JSON.parse(
    fs.readFileSync(conversationFile, 'utf8'),
    dateParser
  );

  Projects.insertMany(projects)
    .then(() => NLUModels.insertMany(models))
    .then(() => Conversations.insertMany(conversation))
    .then(() => {
      done();
    });
});

describe('## last import', () => {
  describe('# GET /conversations/environment/{env}/latest-imported-event', () => {
    it('Should retrieve last import in production', done => {
      request(app)
        .get('/conversations/environment/production/latest-imported-event')
        .expect(httpStatus.OK)
        .then(res => {
          expect(res.body).to.deep.equal({
            timestamp: 1550000000
          });
          done();
        })
        .catch(done);
    });

    it('Should give 0 as no import yet in staging', done => {
      request(app)
        .get('/conversations/environment/staging/latest-imported-event')
        .expect(httpStatus.OK)
        .then(res => {
          expect(res.body).to.deep.equal({
            timestamp: 0
          });
          done();
        })
        .catch(done);
    });

    it('Should retrieve last import in developement', done => {
      request(app)
        .get('/conversations/environment/developement/latest-imported-event')
        .expect(httpStatus.OK)
        .then(res => {
          expect(res.body).to.deep.equal({
            timestamp: 1450000000
          });
          done();
        })
        .catch(done);
    });

    it('Should return 400 when envirnonement does not exist', done => {
      request(app)
        .get('/conversations/environment/prodduction/latest-imported-event')
        .expect(httpStatus.BAD_REQUEST)
        .then(res => {
          expect(res.body).to.deep.equal({
            error:
              'environement should be one of: production, staging, developement'
          });
          done();
        })
        .catch(done);
    });
  });
});

describe('## import format checking', () => {
  describe('# POST /conversations/environment/{env}', () => {
    it('should fail with invalid body', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          dummy: [{ name: 'test', confidence: 0.99 }],
          text: 'blabla'
        })
        .expect(httpStatus.BAD_REQUEST)
        .then(res => {
          expect(res.body).to.deep.equal({
            error: 'the body is missing conversations or processNlu, or both'
          });
          done();
        })
        .catch(done);
    });
    it('should fail with invalid conversations type', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          conversations: 'bad',
          processNlu: false
        })
        .expect(httpStatus.BAD_REQUEST)
        .then(res => {
          expect(res.body).to.deep.equal({
            error: 'conversations should be an array'
          });
          done();
        })
        .catch(done);
    });
    it('should fail with invalid processNlu type', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          conversations: [],
          processNlu: 'false'
        })
        .expect(httpStatus.BAD_REQUEST)
        .then(res => {
          expect(res.body).to.deep.equal({
            error: 'processNlu should be an boolean'
          });
          done();
        })
        .catch(done);
    });
    it('should import a new conversation and update and oldOne', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          conversations: conversationsToImport.slice(0, 2),
          processNlu: true
        })
        .expect(httpStatus.OK)
        .then(async res => {
          expect(res.body).to.deep.equal({
            message: 'successfuly imported all conversations'
          });
          Conversations.find({ _id: 'new' })
            .lean()
            .exec()
            .then(newData => {
              expect(newData).to.have.length(1);
              Conversations.find({ _id: 'update' })
                .lean()
                .exec()
                .then(updateData => {
                  expect(updateData).to.have.length(1);
                  expect(updateData[0].updatedAt).to.not.equal(
                    new Date(1550000000)
                  );
                  Activity.find({ text: 'newevent' })
                    .lean()
                    .exec()
                    .then(activityData => {
                      expect(activityData).to.have.length(1);
                      done();
                    });
                });
            })
            .catch(done);
        });
    });

    it('should not import a conversation with a non existing project id', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          conversations: conversationsToImport.slice(2, 3),
          processNlu: true
        })
        .expect(httpStatus.PARTIAL_CONTENT)
        .then(async res => {
          expect(res.body).to.deep.equal({
            messageConversation:
              'some conversation were not added, either the _id is missing or projectId does not exist',
            notValids: [conversationsToImport[2]]
          });
          Conversations.find({ _id: 'projectnotexist' })
            .lean()
            .exec()
            .then(newData => {
              expect(newData).to.have.length(0);
              done();
            });
        })
        .catch(done);
    });
    it('should not import a wrong parse data with a non existing project id', done => {
      request(app)
        .post('/conversations/environment/production')
        .send({
          conversations: conversationsToImport.slice(3),
          processNlu: true
        })
        .expect(httpStatus.PARTIAL_CONTENT)
        .then(async res => {
          expect(res.body).to.deep.equal({
            messageParseData:
              'Some parseData have not been added to activity, the corresponding models could not be found ',
            invalidParseDatas: [
              [conversationsToImport[3].tracker.events[6].parse_data]
            ]
          });
          Conversations.find({ _id: 'projectnotexist' })
            .lean()
            .exec()
            .then(newData => {
              expect(newData).to.have.length(0);
              done();
            });
        })
        .catch(done);
    });
  });
});
