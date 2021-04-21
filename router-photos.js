const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const photos = require('./photos');
const AWS = require('./aws');

const awsBucket = "static2.dheera.net";
const imgixDomain = "dheera.imgix.net";

s3 = new AWS.S3({apiVersion: '2006-03-01'});

let listPhotos = (albumName) => {
    return new Promise((resolve, reject) => {
        s3.listObjects({Bucket: awsBucket, Prefix: "photos/" + albumName}, (err, data) => {
            if(err) {
                console.log("Error", err);
	        reject("Error" + err.Code);
            }
            if(!data.Contents) {
                console.log(data);
                reject("no contents");
            }
	    outputList = [];
	    for (i in data.Contents) {
		 filename = data.Contents[i].Key.replace("photos/", "");
		 if(filename.indexOf(".jpg") !== -1) {
                     outputList.push(filename);
		 }
	    }
            resolve(outputList);
        });
    });
}

listPhotos("calnight").then(r => console.log(r));

router.get('/', (req, res) => res.render('photos/index.html'));

router.get('/:albumName', (req, res) => {
    listPhotos(req.params["albumName"])
        .then(images => res.render('photos/album.html', {
            images: images,
            imgixDomain: imgixDomain,
	    title: "Title",
	    description: "Lorem ipsum",
        }));
});

router.get('/:albumName/:imageName', (req, res) => {
  res.render('photos/image.html')
});

module.exports = router;
