let onLoad = [];
let onReady = [];

window.onload = function() { for(i in onLoad) onLoad[i](); }
if(document.addEventListener) {
  document.addEventListener("DOMContentLoaded", function() { for(i in onReady) onReady[i](); });
} else if(document.attachEvent) {
  document.attachEvent("onDOMContentLoaded", function() { for(i in onReady) onReady[i](); });
}

onReady.push(function() {
  if(window.localStorage.getItem("light") === "true") {
    document.body.classList.add("light");
    document.querySelector('.navbar-button-light').querySelector('i').classList.add('fa-sun');
    document.querySelector('.navbar-button-light').querySelector('i').classList.remove('fa-moon');
  }
});

const debounce = function(fn) {
  let frame;
  return function(...params) {
    if (frame) { 
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(function() {
      fn(...params);
    });
  } 
};

const storeScroll = function() {
  if(window.scrollY < 20) document.documentElement.dataset.scroll = 0;
  else document.documentElement.dataset.scroll = window.scrollY;
}

document.addEventListener('scroll', debounce(storeScroll), { passive: true });
storeScroll();

let toggleLight = function() {
  document.body.classList.toggle("light");
  document.querySelector('.navbar-button-light').querySelector('i').classList.toggle('fa-moon');
  document.querySelector('.navbar-button-light').querySelector('i').classList.toggle('fa-sun');
  window.localStorage.setItem("light", document.body.classList.contains("light"));
}

// adapted from https://photoswipe.com/documentation/getting-started.html
var initPhotoSwipeFromDOM = function(gallerySelector) {

    // parse slide data (url, title, size ...) from DOM elements
    // (children of gallerySelector)
    var parseThumbnailElements = function(el) {
        var thumbElements = el.childNodes,
            numNodes = thumbElements.length,
            items = [],
            figureEl,
            linkEl,
            size,
            item;

        for(var i = 0; i < numNodes; i++) {

            let linkEl = thumbElements[i]; // <a> element

            if(linkEl.nodeType !== 1) {
                continue;
            }

            let size = defaultImageSize.split("x");

            let item = {
                src: linkEl.getAttribute('href'),
                w: parseInt(size[0], 10),
                h: parseInt(size[1], 10),
		autoSize: true,
            };

            if(linkEl.children.length > 1) {
                item.title = "caption";
            }

            if(linkEl.children.length > 0) {
                // <img> thumbnail element, retrieving thumbnail url
                // item.msrc = linkEl.children[0].getAttribute('src');
                item.msrc = linkEl.children[0].getAttribute('src');
            }

            item.el = linkEl; // save link to element for getThumbBoundsFn
            items.push(item);
        }
        return items;
    };

    // find nearest parent element
    var closest = function closest(el, fn) {
        return el && ( fn(el) ? el : closest(el.parentNode, fn) );
    };

    // triggers when user clicks on thumbnail
    var onThumbnailsClick = function(e) {
        e = e || window.event;
        e.preventDefault ? e.preventDefault() : e.returnValue = false;

        var eTarget = e.target || e.srcElement;

        // find root element of slide
        var clickedListItem = closest(eTarget, function(el) {
            return (el.tagName && el.tagName.toUpperCase() === 'A');
        });

        if(!clickedListItem) {
            return;
        }

        // find index of clicked item by looping through all child nodes
        // alternatively, you may define index via data- attribute
        var clickedGallery = clickedListItem.parentNode,
            childNodes = clickedListItem.parentNode.childNodes,
            numChildNodes = childNodes.length,
            nodeIndex = 0,
            index;

        for (var i = 0; i < numChildNodes; i++) {
            if(childNodes[i].nodeType !== 1) {
                continue;
            }

            if(childNodes[i] === clickedListItem) {
                index = nodeIndex;
                break;
            }
            nodeIndex++;
        }


        if(index >= 0) {
            // open PhotoSwipe if valid index found
            openPhotoSwipe( index, clickedGallery );
        }
        return false;
    };

    // parse picture index and gallery index from URL (#&pid=1&gid=2)
    var photoswipeParseHash = function() {
        var hash = window.location.hash.substring(1),
        params = {};

        if(hash.length < 5) {
            return params;
        }

        var vars = hash.split('&');
        for (var i = 0; i < vars.length; i++) {
            if(!vars[i]) {
                continue;
            }
            var pair = vars[i].split('=');
            if(pair.length < 2) {
                continue;
            }
            params[pair[0]] = pair[1];
        }

        if(params.gid) {
            params.gid = parseInt(params.gid, 10);
        }

        return params;
    };

    var openPhotoSwipe = function(index, galleryElement, disableAnimation, fromURL) {
        var pswpElement = document.querySelectorAll('.pswp')[0],
            gallery,
            options,
            items;

        items = parseThumbnailElements(galleryElement);

        // define options (if needed)
        options = {

            // define gallery index (for URL)
            galleryUID: galleryElement.getAttribute('data-uid'),

            getThumbBoundsFn: function(index) {
                // See Options -> getThumbBoundsFn section of documentation for more info
                var thumbnail = items[index].el.getElementsByTagName('img')[0], // find thumbnail
                    pageYScroll = window.pageYOffset || document.documentElement.scrollTop,
                    rect = thumbnail.getBoundingClientRect();

                return {x:rect.left, y:rect.top + pageYScroll, w:rect.width};
            }

        };

        // PhotoSwipe opened from URL
        if(fromURL) {
            if(options.galleryPIDs) {
                // parse real index when custom PIDs are used
                // http://photoswipe.com/documentation/faq.html#custom-pid-in-url
                for(var j = 0; j < items.length; j++) {
                    if(items[j].pid == index) {
                        options.index = j;
                        break;
                    }
                }
            } else {
                // in URL indexes start from 1
                options.index = parseInt(index, 10) - 1;
            }
        } else {
            options.index = parseInt(index, 10);
        }

        // exit if index not found
        if( isNaN(options.index) ) {
            return;
        }

        if(disableAnimation) {
            options.showAnimationDuration = 0;
        }

	getUncroppedImage(items[index].msrc, 256, 400).then(function(dataUrl) {
          items[index].msrc = dataUrl;
          gallery = new PhotoSwipe( pswpElement, PhotoSwipeUI_Default, items, options);
          gallery.init();
	});

        // Pass data to PhotoSwipe and initialize it
    };

    // loop through all gallery elements and bind events
    var galleryElements = document.querySelectorAll( gallerySelector );
    for(var i = 0, l = galleryElements.length; i < l; i++) {
        galleryElements[i].setAttribute('data-uid', i+1);
        galleryElements[i].onclick = onThumbnailsClick;
    }

    // Parse URL and open gallery if it contains #&pid=3&gid=1
    var hashData = photoswipeParseHash();
    if(hashData.pid && hashData.gid) {
        openPhotoSwipe( hashData.pid ,  galleryElements[ hashData.gid - 1 ], true, true );
    }
};


let collapsePhotoContent = function() {
  document.getElementsByClassName('photo-content')[0].classList.add('collapsed');
  document.getElementsByClassName('photo-content-expand')[0].classList.add('collapsed');
}

let expandPhotoContent = function() {
  document.getElementsByClassName('photo-content')[0].classList.remove('collapsed');
  document.getElementsByClassName('photo-content-expand')[0].classList.remove('collapsed');
}

let getUncroppedImage =  function(inputImageUrl, width, height) {
  return new Promise(function(resolve, reject) {
    let inputImage = new Image();
    inputImage.crossOrigin="anonymous";
    let outputImage = document.createElement('canvas');
    outputImage.width = width;
    outputImage.height = height;
    inputImage.onload = function() {
      let ctx = outputImage.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, outputImage.width, outputImage.height);
      ctx.drawImage(inputImage, outputImage.width/2 - inputImage.naturalHeight/2, outputImage.height/2 - inputImage.naturalHeight/2);
      resolve(outputImage.toDataURL());
    }
    inputImage.src = inputImageUrl;
  });
}
