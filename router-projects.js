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
                         projects.push(project);
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
                image: projectName + "/" + index.image,
                body: body,
            });
        },
        reason => reject(reason)
    );
});

let getSignedImageURL = (imageFile, params) => {
    let path = imageFile + "?" + params;
    let checksum = md5(config_projects.imgixSecureToken + "/" + config_projects.prefix + path); // imgix uses MD5, not my choice
    let url = "https://" + config_projects.imgixDomain + "/" + config_projects.prefix + path + "&s=" + checksum;
    return url;
}

router.get('/', (req, res) => {
    Promise.all([
      aws.getObject_cached({Bucket: config_projects.bucket, Key: config_projects.prefix + "index.json"}),
      getProjects()
    ])
    .then((data) => {
        let index = JSON.parse(data[0].Body.toString('utf-8'));
	let projects = data[1];

        let featured = index["featured"] || [];

        let projectsUnfeatured = [];
	let projectsFeatured = [];

        for(i in projects) {
            projects[i].thumbnail = getSignedImageURL(projects[i].image, "w=250&h=250&fit=crop&q=50");
            if(featured.includes(projects[i].name)) projectsFeatured.push(projects[i]);
            else projectsUnfeatured.push(projects[i]);
        }

        res.render("projects/index.html", { projectsFeatured: projectsFeatured, projectsUnfeatured: projectsUnfeatured, userInfo : req.userInfo });
    }, reason => {
        log.error(["projects_index", reason]);
        res.sendStatus(500);
    });
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
