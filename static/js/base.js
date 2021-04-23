document.addEventListener('DOMContentLoaded', () => {
  if(window.localStorage.getItem("light") === "true") {
    document.body.classList.add("light");
    document.querySelector('.navbar-button-light').querySelector('i').classList.add('fa-sun');
    document.querySelector('.navbar-button-light').querySelector('i').classList.remove('fa-moon');
  }
});

const debounce = (fn) => {
  let frame;
  return (...params) => {
    if (frame) { 
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(() => {
      fn(...params);
    });
  } 
};

const storeScroll = () => {
  if(window.scrollY < 20) document.documentElement.dataset.scroll = 0;
  else document.documentElement.dataset.scroll = window.scrollY;
}

document.addEventListener('scroll', debounce(storeScroll), { passive: true });
storeScroll();

let toggleLight = () => {
  document.body.classList.toggle("light");
  document.querySelector('.navbar-button-light').querySelector('i').classList.toggle('fa-moon');
  document.querySelector('.navbar-button-light').querySelector('i').classList.toggle('fa-sun');
  window.localStorage.setItem("light", document.body.classList.contains("light"));
}
