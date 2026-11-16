import PhotoSwipeLightbox from '/vendor/photoswipe/photoswipe-lightbox.esm.js';

const gallery = document.querySelector('#photo-gallery');
if (gallery) {
  const lightbox = new PhotoSwipeLightbox({
    gallery: '#photo-gallery', children: '.photo-link',
    pswpModule: () => import('/vendor/photoswipe/photoswipe.esm.js'),
    bgOpacity: 1, showHideAnimationType: 'fade', loop: false,
    padding: { top: 64, bottom: 76, left: 12, right: 12 },
    secondaryZoomLevel: 1, maxZoomLevel: zoom => Math.max(1, zoom.fit * 4),
    closeTitle: gallery.dataset.closeLabel, zoomTitle: gallery.dataset.zoomLabel,
    arrowPrevTitle: gallery.dataset.previousLabel, arrowNextTitle: gallery.dataset.nextLabel,
    errorMsg: gallery.dataset.errorLabel,
  });
  lightbox.on('uiRegister', () => lightbox.pswp.ui.registerElement({
    name: 'photo-label', order: 9, isButton: false, appendTo: 'root',
    onInit(element, pswp) {
      const updateLabel = () => {
        element.textContent = pswp.currSlide?.data.element?.dataset.photoLabel || '';
        element.hidden = !element.textContent;
      };
      pswp.on('change', updateLabel);
      updateLabel();
    },
  }));
  lightbox.init();
}
