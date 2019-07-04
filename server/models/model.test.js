/* eslint-disable no-undef */
/* eslint-disable max-len */
const request = require('supertest-as-promised');
const httpStatus = require('http-status');
const chai = require('chai'); // eslint-disable-line import/newline-after-import
const expect = chai.expect;
const app = require('../../app');
chai.config.includeStack = true;
const Project = require('../project/project.model');
const Model = require('./model.model');

before(function(done) {
    const fs = require('fs');
    const projectsFile = __dirname + '/test_data/projects.json';
    const modelsFile = __dirname + '/test_data/models.json';
    const projects = JSON.parse(fs.readFileSync(projectsFile, 'utf8'));
    const models = JSON.parse(fs.readFileSync(modelsFile, 'utf8'));
    Project.insertMany(projects)
        .then(() => Model.insertMany(models))
        .then(() => {
            done();
        });
});

describe('## Models', () => {
    describe('# GET /project/{projectId}/models/published', () => {
        it('Should retrieve published models succesfully', done => {
            request(app)
                .get('/project/project_id_models/models/published')
                .expect(httpStatus.OK)
                .then(res => {
                    expect(res.body).to.deep.equal({
                        en: 'model2',
                        fr: 'model1',
                    });
                    done();
                })
                .catch(done);
        });

        it('Should retrieve published models and default language succesfully', done => {
            request(app)
                .get('/project/project_id_models_with_default_lang/models/published')
                .expect(httpStatus.OK)
                .then(res => {
                    expect(res.body).to.deep.equal({
                        en: 'model2',
                        fr: 'model1',
                        default_language: 'fr',
                    });
                    done();
                })
                .catch(done);
        });

        it('Should return 401 when project does not exist', done => {
            request(app)
                .get('/project/kkk/models/published')
                .expect(httpStatus.UNAUTHORIZED)
                .then(() => {
                    done();
                })
                .catch(done);
        });
    });
});