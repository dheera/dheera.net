const log = require('pino')({prettyPrint: true, level: 'debug'});
const router = require('express').Router();
const photos = require('./photos');
const aws = require('./aws');
const fs = require('fs');
const config_photos = JSON.parse(fs.readFileSync('./config/photos.json', 'utf8'));
const md5 = require('md5');

let listPhotos = (albumName) => {
    return new Promise((resolve, reject) => {
        aws.s3.listObjects({Bucket: config_photos.bucket, Prefix: config_photos.prefix + albumName}, (err, data) => {
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
		 filename = data.Contents[i].Key.replace(config_photos.prefix, "");
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
        .then(imagefilelist => {
	    images = [];
	    for (i in imagefilelist) {
		src = imagefilelist[i] + "?w=3072";
		checksum = md5(config_photos.imgixSecureToken + "/" + src);
		src = "https://" + config_photos.imgixDomain + "/" + src + "&s=" + checksum;
		thumbnail = imagefilelist[i] + "?w=250";
		checksum = md5(config_photos.imgixSecureToken + "/" + thumbnail);
		thumbnail = "https://" + config_photos.imgixDomain + "/" + thumbnail + "&s=" + checksum;
		images.push({
		    path: imagefilelist[i],
		    thumbnail: thumbnail,
		    src: src,
		});
            }
	    res.render('photos/album.html', {
                images: images,
                title: "Title",
                description: "Lorem ipsum",
            })
	});
});

router.get('/:albumName/:imageName', (req, res) => {
  res.render('photos/image.html')
});

module.exports = router;
