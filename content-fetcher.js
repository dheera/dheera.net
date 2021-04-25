const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const aws = require('./aws');
const fs = require('fs');
const config_photos = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const config_posts = JSON.parse(fs.readFileSync('./config/posts.json', 'utf8'));
const config_projects = JSON.parse(fs.readFileSync('./config/projects.json', 'utf8'));
const md5 = require('md5');

let getIndex = () => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_projects.bucket, Key: "index.json"})
    .then(
      data => {
        let index = JSON.parse(data.Body.toString('utf-8'));
        let promises = [];
        for(i in index.featured) {
          let [type, name] = index.featured[i].split("/");
          if(index.featured[i].startsWith(config_photos.prefix)) {
            promises.push(getAlbum(name));
	  } else if(index.featured[i].startsWith(config_posts.prefix)) {
            promises.push(getPost(name));
	  } else if(index.featured[i].startsWith(config_projects.prefix)) {
            promises.push(getProject(name));
	  }
        }

        Promise.allSettled(promises).then(results => {
          let featured = [];
          for(i in results) {
            if(results[i].status === "fulfilled") {
              featured.push(results[i].value);
            } else {
	      featured.push({"_type": "error", "name": "error", "title": "error", "subtitle": "error"});
	    }
	  }
          resolve({featured: featured});
        });
      },
      reason => reject(reason)
    )
});

let getProjectsIndex = () => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_projects.bucket, Key: config_projects.prefix + "index.json"})
    .then(data => resolve(JSON.parse(data.Body.toString('utf-8'))), reason => reject(reason));
});

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
                    log.error(["getProject", [projectName, e]]);
                    index = { "title": projectName };
                }
            } else {
                index = { "title": projectName };
            }

            let baseUrl = "https://" + config_projects.domain + "/" + config_projects.prefix + projectName + "/";

            body = body.replace(/src="(.*?)"/g, 'src="' + baseUrl + "$1" + '"');

            resolve({
		_type: "project",
		name: projectName,
		url: "/" + config_projects.prefix + projectName + "/",
                title: index.title || "",
                subtitle: index.subtitle || "",
                image: config_projects.prefix + projectName + "/" + index.image,
                body: body,
            });
        },
        reason => reject(reason)
    );
});

let getAlbumsIndex = () => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_photos.bucket, Key: config_photos.prefix + "index.json"})
    .then(data => resolve(JSON.parse(data.Body.toString('utf-8'))), reason => reject(reason));
});

let getAlbums = () => new Promise((resolve, reject) => {
    aws.listObjects_cached({Bucket: config_photos.bucket, Prefix: config_photos.prefix, Delimiter: "/"})
    .then(
        result => {
            let albumNames = result.CommonPrefixes
		.map(item => item.Prefix.replace(config_photos.prefix, "").replace("/", ""))
		.filter(name => name[0] != "_");
            let albums = [];
            let promises = [];
            for(i in albumNames) {
                promises.push(getAlbum(albumNames[i]));
            }
            Promise.allSettled(promises).then(results => {
                for(i in results) {
                    if(results[i].status === "fulfilled") {
                        album = results[i].value;
                        album.name = albumNames[i];
                        albums.push(album);
                    }
                }
                resolve(albums);
            });
        },
        reason => reject(reason)
    );
});

let getAlbum = (albumName) => new Promise((resolve, reject) => {
    albumName = albumName.replace(/[^A-Za-z0-9_\- ]/g, ""); // sanitize
    Promise.all([
        aws.listObjects_cached({Bucket: config_photos.bucket, Prefix: config_photos.prefix + albumName}),
        aws.getObject_cached({Bucket: config_photos.bucket, Key: config_photos.prefix + albumName + "/index.json"}),
    ]).then(
        data => {
            let objectList = data[0].Contents;
            let index = {};
            try {
                   index = JSON.parse(data[1].Body.toString('utf-8'));
            } catch(e) {
                index = {
                    "title": "Error",
                    "description": e.toString("utf-8"),
                }
            }

            imageFiles = [];
            for (i in objectList) {
                 filename = objectList[i].Key;
                 if(filename.indexOf(".jpg") !== -1) {
                     imageFiles.push(filename);
                 }
            }
            resolve({
		_type: "album",
		name: albumName,
		url: "/" + config_photos.prefix + albumName + "/",
                image: imageFiles[0],
                imageFiles: imageFiles || [],
                title: index.title || "",
                subtitle: index.subtitle || "",
                license: index.license || "",
                description: (index.description || "").replace(/\n/gs, "<br>"),
                thumbAspectRatio: index.thumbAspectRatio || 1.0,
            });
        },
        reason => reject(reason)
    );
});

let getPosts = () => new Promise((resolve, reject) => {
    aws.listObjects_cached({Bucket: config_posts.bucket, Prefix: config_posts.prefix, Delimiter: "/"})
    .then(
        result => {
             let postNames = result.CommonPrefixes.map(item => item.Prefix.replace(config_posts.prefix, "").replace("/", ""));
             let promises = [];
             for(i in postNames) {
                 promises.push(getPost(postNames[i]));
             }
             Promise.allSettled(promises).then(results => {
		 let posts = [];
                 for(i in results) {
                     if(results[i].status === "fulfilled") {
                         post = results[i].value;
                         post.name = postNames[i];
                         posts.push(post);
                     }
                 }
                 resolve(posts);
             });
        },
        reason => reject(reason)
    );
});

let getPost = (postName) => new Promise((resolve, reject) => {
    aws.getObject_cached({Bucket: config_posts.bucket, Key: config_posts.prefix + postName + "/index.html"})
    .then(
        data => {
            let index = {};
            let body = data.Body.toString('utf-8');
            let infoMatch = body.match(/<!--(.*?)-->/s);
	    if(infoMatch) {
                try {
                    index = JSON.parse(infoMatch[1]);
                } catch(e) {
                    log.error(["getPost", e]);
                    index = { "title": postName };
                }
            } else {
                index = { "title": postName };
            }

            let baseUrl = "https://" + config_posts.domain + "/" + config_posts.prefix + postName + "/";

            body = body.replace(/src="(.*?)"/g, 'src="' + baseUrl + "$1" + '"');

            resolve({
		_type: "post",
		name: postName,
		url: "/" + config_posts.prefix + postName + "/",
                title: index.title || "",
                subtitle: index.subtitle || "",
                image: config_posts.prefix + postName + "/" + index.image,
		date: postName.substr(0,4) + "-" + postName.substr(4, 2) + "-" + postName.substr(6, 2),
                body: body,
            });
        },
        reason => reject(reason)
    );
});

let getSignedImageURL = (imageFile, params) => {
    let path = imageFile + "?" + params;
    let checksum = md5(config_photos.imgixSecureToken + "/" + path); // imgix uses MD5, not my choice
    let url = "https://" + config_photos.imgixDomain + "/" + path + "&s=" + checksum;
    return url;
}

// kick off prefetching
setInterval(getAlbums, 500);

module.exports = {
  getIndex: getIndex,
  getProject: getProject,
  getProjects: getProjects,
  getProjectsIndex: getProjectsIndex,
  getAlbum: getAlbum,
  getAlbums: getAlbums,
  getAlbumsIndex: getAlbumsIndex,
  getPost: getPost,
  getPosts: getPosts,
  getSignedImageURL: getSignedImageURL,
}
