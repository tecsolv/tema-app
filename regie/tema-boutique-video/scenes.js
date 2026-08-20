/* Bibliothèque vidéo TeMa Boutique — les visuels fournis sont intégrés ici. */
const asset = (name) => `assets/${name}`;
const supplied = {
  welcome: asset('Copilot_20260819_222249.png'),
  groceries: asset('Copilot_20260819_222452.png'),
  mobileMoney: asset('Copilot_20260819_223900.png'),
  pastry: asset('Copilot_20260819_224409.png'),
  logo: asset('Copilot_20260819_224636.png'),
  appliances: asset('Copilot_20260819_225129.png'),
  school: asset('Copilot_20260819_225823.png'),
  digital: asset('Copilot_20260819_232713.png'),
  family: asset('Copilot_20260819_233057.png'),
  contact: asset('Copilot_20260820_002803.png')
};

const imageScene = (src, label, effect) => `<article class="scene image-scene ${effect}" style="--scene-image:url('${src}')" aria-label="${label}"><div class="image-backdrop"></div><img class="scene-image" src="${src}" alt="${label}" /></article>`;
const officialContact = `<article class="scene image-scene effect-contact contact-scene" style="--scene-image:url('${supplied.contact}')" aria-label="Coordonnées TeMa Boutique"><div class="image-backdrop"></div><img class="scene-image" src="${supplied.contact}" alt="TeMa Boutique" /><div class="contact-correction"><p><b>YAMOUSSOUKRO</b> — quartier Ebenezer, fin goudron</p><p><b>TÉLÉPHONE</b> 27 30 655 526 · 07 57 74 22 84</p><p><b>EMAIL</b> temaboutique@gmail.com</p><p><b>FACEBOOK / TIKTOK</b> @temaboutique</p></div></article>`;

const playlist = [
  [supplied.welcome, 'Bienvenue chez TeMa Boutique', 'effect-golden'],
  [supplied.groceries, 'Vos courses du quotidien', 'effect-left'],
  [supplied.digital, 'Services numériques et informatique', 'effect-diagonal'],
  [supplied.mobileMoney, 'Votre Mobile Money', 'effect-right'],
  [supplied.school, 'Fournitures scolaires et de bureau', 'effect-lift'],
  [supplied.family, 'Univers des enfants et bien-être', 'effect-drop'],
  [supplied.appliances, 'Électroménagers', 'effect-aperture'],
  [supplied.pastry, 'Pâtisserie sur commande', 'effect-sweep'],
  [supplied.logo, 'TeMa Boutique — Pour votre famille, chaque jour', 'effect-focus']
];

const stage = document.querySelector('#stage');
stage.innerHTML = [...playlist.map(([src, label, effect]) => imageScene(src, label, effect)), officialContact, imageScene(supplied.logo, 'TeMa Boutique — conclusion', 'effect-finale')].join('');
const scenes = [...document.querySelectorAll('.scene')];
let current = 0;
const duration = 5400;
const randomEffects = ['fx-fade', 'fx-crossfade', 'fx-kenburns-in', 'fx-kenburns-out', 'fx-pan', 'fx-spin', 'fx-blinds', 'fx-cube', 'fx-wipe', 'fx-blur', 'fx-glitch', 'fx-grid'];
let previousEffect = '';
function chooseEffect() {
  const choices = randomEffects.filter((effect) => effect !== previousEffect);
  previousEffect = choices[Math.floor(Math.random() * choices.length)];
  return previousEffect;
}
function show(index) {
  const old = scenes[current];
  if (old) { old.classList.remove('active'); old.classList.add('exit'); }
  current = index % scenes.length;
  const next = scenes[current];
  next.classList.remove(...randomEffects);
  next.classList.add(chooseEffect());
  next.classList.remove('exit');
  requestAnimationFrame(() => next.classList.add('active'));
}
show(0);
setInterval(() => show(current + 1), duration);
