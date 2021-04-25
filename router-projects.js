const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const contentFetcher = require('./content-fetcher');

router.get('/', (req, res) => {
    Promise.all([
      contentFetcher.getProjectsIndex(),
      contentFetcher.getProjects(),
    ])
    .then((data) => {
        let index = data[0];
	let projects = data[1];

        let featured = index["featured"] || [];

        let projectsUnfeatured = [];
	let projectsFeatured = [];

        for(i in projects) {
            projects[i].thumbnail = contentFetcher.getProjectsSignedImageURL(projects[i].image, "w=250&h=250&fit=crop&q=50");
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
    contentFetcher.getProject(req.params["projectName"])
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
