const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_projects = JSON.parse(fs.readFileSync('./config/projects.json', 'utf8'));
const md5 = require('md5');

let getProjects = () => new Promise((resolve, reject) => {
    aws.listObjects_cached({Bucket: config_projects.bucket, Prefix: config_projects.prefix, Delimiter: "/"})
    .then(
        result => {
             let projectNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_projects.prefix, "").replace("/", ""));
             let promises = [];
             for(i in projectNames) {
                 promises.push(getProject(projectNames[i]));
             }
             Promise.allSettled(promises).then(results => {
		 let projects = [];
                 for(i in results) {
                     if(results[i].status === "fulfilled") {
                         project = results[i].value;
                         project.name = projectNames[i];
                         projects.push(album);
                     }
                 }
                 resolve(projects);
             });
        },
        reason => reject(reason)
    );
});

let getProject = (projectName) => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_projects.bucket, Key: config_projects.prefix + projectName + "/index.html"})
    .then(
        data => {
            let index = {};
            let body = data.Body.toString('utf-8');
            let infoMatch = body.match(/<!--(.*?)-->/s);
	    if(infoMatch) {
                try {
                    index = JSON.parse(infoMatch[1]);
                } catch(e) {
                    log.error(["getProject", e]);
                    index = { "title": projectName };
                }
            } else {
                index = { "title": projectName };
            }

            let baseUrl = "https://" + config_projects.domain + "/" + config_projects.prefix + projectName + "/";

            body = body.replace(/src="(.*?)"/g, 'src="' + baseUrl + "$1" + '"');

            resolve({
                title: index.title || "",
                subtitle: index.subtitle || "",
                body: body,
            });
        },
        reason => reject(reason)
    );
});

router.get('/', (req, res) => {
    getProjects()
    .then(
        projects => res.render("projects/index.html", { projects: projects, userInfo : req.userInfo }),
        reason => {
            log.error(["projects_index", reason]);
            res.sendStatus(500);
        }
    );
});

router.get('/:projectName', (req, res) => {
    console.log(req.params);
    getProject(req.params["projectName"])
    .then(
        project => res.render('projects/project.html', { project: project, userInfo: req.userInfo }),
        reason => {
            log.error(["projects", reason]);
            if(reason && reason.code === "NoSuchKey") return res.sendStatus(404);
            res.sendStatus(500);
        },
    );
});

module.exports = router;
