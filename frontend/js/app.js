/* ═══════════════════════════════════════════
   CampusConnect — Frontend App JS
   ═══════════════════════════════════════════ */

const API = 'http://localhost:8000/api';
const REACTIONS = ['👍','❤️','😂','😮','😢','🔥','🎉'];
const DEPT_SHORT = {
  'Computer Science & Engineering':'CSE','Electrical Engineering':'EEE',
  'Mechanical Engineering':'ME','Business Administration':'BBA',
  'Physics':'PHY','Mathematics':'MATH','Chemistry':'CHEM','Economics':'ECON',
  'Law':'LAW','Medical Sciences':'MED','Architecture':'ARCH','Arts & Humanities':'AH'
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentUser = null;
let token = null;
let postType = 'normal';
let imgData = null;
let feedOffset = 0;
let currentPostId = null; // for post modal
let allUsers = [];

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.onload = async () => {
  token = localStorage.getItem('cc_token');
  const stored = localStorage.getItem('cc_user');
  if (!token || !stored) return window.location.href = 'index.html';
  currentUser = JSON.parse(stored);
  renderSelfUI();
  await Promise.all([fetchUsers(), loadFeed(), loadNotifCount()]);
  renderStories();
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('cc_token');
  localStorage.removeItem('cc_user');
  window.location.href = 'index.html';
}

// ─── API HELPER ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API}${path}`, opts);
    if (res.status === 401) { logout(); return null; }
    return await res.json();
  } catch (e) {
    showToast('⚠️ Cannot reach server. Is the backend running?');
    return null;
  }
}

// ─── SELF UI ──────────────────────────────────────────────────────────────────
function renderSelfUI() {
  setAv(document.getElementById('sbMeAv'), currentUser, 34);
  document.getElementById('sbMeName').textContent = currentUser.name.split(' ')[0];
  document.getElementById('sbMeId').textContent = currentUser.student_id;
  setAv(document.getElementById('composerAv'), currentUser, 44);
  setAv(document.getElementById('commentAv'), currentUser, 34);
}

// ─── AVATAR ───────────────────────────────────────────────────────────────────
function setAv(el, user, size = 42) {
  if (!el || !user) return;
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.fontSize = Math.round(size * 0.36) + 'px';
  el.style.background = user.avatar_color || '#5b6af5';
  el.textContent = initials(user.name);
}
function avEl(user, size = 42, extraClass = '') {
  const d = document.createElement('div');
  d.className = `av ${extraClass}`;
  d.style.width = size + 'px'; d.style.height = size + 'px';
  d.style.fontSize = Math.round(size * 0.36) + 'px';
  d.style.background = user?.avatar_color || '#5b6af5';
  d.textContent = initials(user?.name || '?');
  d.style.cursor = 'pointer';
  if (user) d.onclick = () => openProfile(user.id);
  return d;
}
function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
}
function timeAgo(ts) {
  const d = Math.floor(Date.now() / 1000) - ts;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'); }

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  feed: 'Home Feed', explore: '🔭 Explore', friends: '👥 Friends',
  jokes: '😂 Joke Corner', events: '📅 Events', notifications: '🔔 Notifications'
};

function navigate(view, navEl) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`view-${view}`)?.classList.add('active');
  if (navEl) navEl.classList.add('active');
  else document.querySelector(`[data-view="${view}"]`)?.classList.add('active');
  document.getElementById('topbarTitle').textContent = VIEW_TITLES[view] || view;
  // Load view data
  if (view === 'notifications') loadNotifications();
  if (view === 'events') loadEvents();
  if (view === 'jokes') loadJokes();
  if (view === 'friends') { loadFriendRequests(); searchPeople(); }
  if (view === 'explore') loadExplore();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('sb-open');
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
let searchTimer;
function handleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = document.getElementById('searchInp').value.trim();
    navigate('feed', document.querySelector('[data-view="feed"]'));
    document.getElementById('feedPosts').innerHTML = '<div class="spinner"></div>';
    const data = await api('GET', `/posts?q=${encodeURIComponent(q)}`);
    if (data) renderFeedPosts(data.posts, false);
  }, 400);
}

function searchTag(tag) {
  document.getElementById('searchInp').value = tag;
  handleSearch();
}

// ─── STORIES ──────────────────────────────────────────────────────────────────
function renderStories() {
  const row = document.getElementById('storiesRow');
  // Keep the "add" card
  const addCard = row.querySelector('.story-add');
  row.innerHTML = '';
  row.appendChild(addCard);
  const show = [currentUser, ...allUsers.filter(u => u.id !== currentUser.id)].slice(0, 7);
  show.forEach(u => {
    const card = document.createElement('div');
    card.className = 'story-card has-ring';
    card.style.background = `linear-gradient(160deg,${u.avatar_color}44,${u.avatar_color}22)`;
    const av = avEl(u, 32);
    av.classList.add('story-card-av');
    card.innerHTML = `<div class="story-card-grad"></div>`;
    card.appendChild(av);
    card.innerHTML += `<div class="story-card-name">${u.name.split(' ')[0]}</div>`;
    card.onclick = () => showToast(`${u.name}'s story — coming soon! 📸`);
    row.appendChild(card);
  });
}

// ─── USERS ────────────────────────────────────────────────────────────────────
async function fetchUsers() {
  const data = await api('GET', '/users?q=');
  if (!data) return;
  allUsers = data.users || [];
  renderOnlineList();
  renderSuggested();
}

function renderOnlineList() {
  const el = document.getElementById('onlineList');
  const show = allUsers.slice(0, 5);
  if (!show.length) { el.innerHTML = '<div style="color:var(--text3);font-size:13px">No classmates yet</div>'; return; }
  el.innerHTML = show.map(u => `
    <div class="online-item" onclick="openProfile('${u.id}')">
      <div class="oi-av-wrap">
        ${avHtml(u, 32)}
        <div class="oi-dot"></div>
      </div>
      <div class="oi-info">
        <div class="oi-name">${esc(u.name)}</div>
        <div class="oi-dept">${DEPT_SHORT[u.department] || u.department || ''}</div>
      </div>
    </div>`).join('');
}

function renderSuggested() {
  const el = document.getElementById('suggestedList');
  const show = allUsers.filter(u => u.friendship === 'none').slice(0, 4);
  if (!show.length) { el.innerHTML = '<div style="color:var(--text3);font-size:13px">No suggestions</div>'; return; }
  el.innerHTML = show.map(u => `
    <div class="sugg-item">
      ${avHtml(u, 34, `onclick="openProfile('${u.id}')" style="cursor:pointer"`)}
      <div class="sugg-info">
        <div class="sugg-name" onclick="openProfile('${u.id}')" style="cursor:pointer">${esc(u.name)}</div>
        <div class="sugg-dept">${DEPT_SHORT[u.department] || ''}</div>
      </div>
      <button class="add-btn" onclick="sendFriendReq('${u.id}', this)">Add</button>
    </div>`).join('');
}

function avHtml(user, size = 42, extra = '') {
  return `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.36)}px;background:${user.avatar_color||'#5b6af5'};flex-shrink:0;border-radius:50%;" ${extra}>${initials(user.name)}</div>`;
}

// ─── FEED ─────────────────────────────────────────────────────────────────────
async function loadFeed(append = false) {
  if (!append) {
    feedOffset = 0;
    document.getElementById('feedPosts').innerHTML = '<div class="spinner"></div>';
  }
  const data = await api('GET', `/posts?limit=10&offset=${feedOffset}`);
  if (!data) return;
  renderFeedPosts(data.posts, append);
  feedOffset += (data.posts || []).length;
  document.getElementById('feedLoadMore').style.display = data.posts?.length >= 10 ? 'block' : 'none';
}

function loadMorePosts() { loadFeed(true); }

function renderFeedPosts(posts, append) {
  const c = document.getElementById('feedPosts');
  if (!append) c.innerHTML = '';
  if (!posts?.length && !append) {
    c.innerHTML = `<div class="empty"><div class="empty-icon">📭</div><div class="empty-title">No posts yet</div><div class="empty-sub">Be the first to share something with campus!</div></div>`;
    return;
  }
  posts.forEach(p => {
    const card = buildPostCard(p);
    c.appendChild(card);
  });
}

// ─── POST CARD ────────────────────────────────────────────────────────────────
function buildPostCard(post) {
  const wrap = document.createElement('div');
  wrap.className = 'post-card';
  wrap.dataset.postId = post.id;

  const author = post.author || {};
  const deptShort = DEPT_SHORT[author.department] || '';
  const typeBadge = post.post_type !== 'normal'
    ? `<span class="post-type-badge badge-${post.post_type}">${{joke:'😂 Joke',study:'📚 Study',event:'📅 Event'}[post.post_type]||''}</span>`
    : '';

  // Build reactions pills
  let rxnPills = '';
  if (post.reactions) {
    Object.entries(post.reactions).forEach(([emoji, data]) => {
      if (data.count > 0) {
        rxnPills += `<div class="rxn-pill${data.reacted?' reacted':''}" onclick="reactPost('${post.id}','${emoji}',this)">
          ${emoji} <span>${data.count}</span></div>`;
      }
    });
  }

  const isOwn = post.author_id === currentUser.id;

  wrap.innerHTML = `
    <div class="post-header">
      ${avHtml(author, 44, `onclick="openProfile('${author.id}')" style="cursor:pointer"`)}
      <div class="post-meta">
        <div>
          <span class="post-author-name" onclick="openProfile('${author.id}')">${esc(author.name)}</span>
          <span class="post-dept">${deptShort}</span>${typeBadge}
        </div>
        <div class="post-time">${author.student_id || ''} · ${post.time_ago || timeAgo(post.created_at)}</div>
      </div>
      <button class="post-opts" onclick="postMenu('${post.id}','${isOwn}',this)">⋯</button>
    </div>
    ${post.text ? `<div class="post-body">${esc(post.text)}</div>` : ''}
    ${post.image_data ? `<img class="post-img" src="${post.image_data}" onclick="openLightbox('${post.image_data}')" loading="lazy">` : ''}
    ${rxnPills ? `<div class="reactions-bar">${rxnPills}</div>` : ''}
    <div class="post-footer">
      <button class="pf-btn${post.liked?' liked':''}" onclick="likePost('${post.id}',this)">
        <span class="pf-icon">${post.liked?'❤️':'🤍'}</span> ${post.like_count||0} Like
      </button>
      <button class="pf-btn" onclick="toggleComments('${post.id}',this)">
        <span class="pf-icon">💬</span> ${post.comment_count||0} Comment
      </button>
      <button class="pf-btn" onclick="showReactPicker('${post.id}',this)">
        <span class="pf-icon">😊</span> React
      </button>
      <button class="pf-btn" onclick="sharePost('${post.id}')">
        <span class="pf-icon">↗️</span> Share
      </button>
    </div>
    <div class="comments-area" id="carea-${post.id}">
      <div class="comment-input-row">
        ${avHtml(currentUser, 34)}
        <input class="comment-inp" id="cinp-${post.id}" placeholder="Write a comment..." onkeydown="if(event.key==='Enter')submitInlineComment('${post.id}')">
        <button class="comment-send" onclick="submitInlineComment('${post.id}')">➤</button>
      </div>
      <div id="clist-${post.id}"></div>
    </div>`;
  return wrap;
}

// ─── POST ACTIONS ─────────────────────────────────────────────────────────────
async function likePost(postId, btn) {
  const data = await api('POST', `/posts/${postId}/like`);
  if (!data) return;
  btn.className = `pf-btn${data.liked ? ' liked' : ''}`;
  btn.innerHTML = `<span class="pf-icon">${data.liked ? '❤️' : '🤍'}</span> ${data.count} Like`;
}

async function reactPost(postId, emoji, pill) {
  const data = await api('POST', `/posts/${postId}/react`, { emoji });
  if (!data) return;
  // Refresh the reactions bar
  refreshPostReactions(postId, data.reactions);
}

function refreshPostReactions(postId, rxns) {
  const card = document.querySelector(`[data-post-id="${postId}"]`);
  if (!card) return;
  let bar = card.querySelector('.reactions-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'reactions-bar';
    const footer = card.querySelector('.post-footer');
    card.insertBefore(bar, footer);
  }
  bar.innerHTML = Object.entries(rxns)
    .filter(([,c]) => c > 0)
    .map(([emoji, c]) => `<div class="rxn-pill" onclick="reactPost('${postId}','${emoji}',this)">${emoji} <span>${c}</span></div>`)
    .join('');
}

function showReactPicker(postId, btn) {
  document.querySelectorAll('.rxn-picker').forEach(p => p.remove());
  const picker = document.createElement('div');
  picker.className = 'rxn-picker';
  REACTIONS.forEach(r => {
    const b = document.createElement('button');
    b.className = 'rxn-pick-btn'; b.textContent = r;
    b.onclick = (e) => { e.stopPropagation(); reactPost(postId, r); picker.remove(); showToast(`Reacted with ${r}`); };
    picker.appendChild(b);
  });
  const rect = btn.getBoundingClientRect();
  picker.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top - 56}px`;
  document.body.appendChild(picker);
  setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 10);
}

async function toggleComments(postId, btn) {
  const area = document.getElementById(`carea-${postId}`);
  area.classList.toggle('open');
  if (area.classList.contains('open')) {
    document.getElementById(`cinp-${postId}`)?.focus();
    // Load comments
    const data = await api('GET', `/posts/${postId}`);
    if (data) renderInlineComments(postId, data.comments);
  }
}

function renderInlineComments(postId, comments) {
  const list = document.getElementById(`clist-${postId}`);
  if (!list) return;
  if (!comments?.length) { list.innerHTML = ''; return; }
  list.innerHTML = comments.map(c => commentHtml(c)).join('');
}

function commentHtml(c) {
  const u = { name: c.name, avatar_color: c.avatar_color, id: c.user_id };
  return `<div class="comment-item">
    ${avHtml(u, 30, `onclick="openProfile('${c.user_id}')" style="cursor:pointer"`)}
    <div class="comment-bubble">
      <div class="cb-name">${esc(c.name)}</div>
      <div class="cb-text">${esc(c.text)}</div>
      <div class="cb-time">${timeAgo(c.created_at)}</div>
    </div>
  </div>`;
}

async function submitInlineComment(postId) {
  const inp = document.getElementById(`cinp-${postId}`);
  const text = inp?.value.trim();
  if (!text) return;
  const data = await api('POST', `/posts/${postId}/comments`, { text });
  if (!data) return;
  inp.value = '';
  const list = document.getElementById(`clist-${postId}`);
  if (list) list.insertAdjacentHTML('beforeend', commentHtml(data.comment));
  // Update comment count
  const card = document.querySelector(`[data-post-id="${postId}"]`);
  if (card) {
    const cmtBtn = card.querySelectorAll('.pf-btn')[1];
    if (cmtBtn) {
      const cur = parseInt(cmtBtn.textContent.match(/\d+/)?.[0] || 0) + 1;
      cmtBtn.innerHTML = `<span class="pf-icon">💬</span> ${cur} Comment`;
    }
  }
  showToast('Comment posted! 💬');
}

function postMenu(postId, isOwn, btn) {
  document.querySelectorAll('.post-menu-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'post-menu-popup rxn-picker';
  popup.style.borderRadius = '12px';
  popup.style.padding = '8px';
  popup.style.flexDirection = 'column';
  popup.style.gap = '4px';
  const items = isOwn === 'true'
    ? [{ icon: '🗑️', label: 'Delete Post', fn: () => deletePost(postId) }]
    : [{ icon: '🚩', label: 'Report Post', fn: () => showToast('Post reported. Thanks!') }];
  items.forEach(({ icon, label, fn }) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'background:none;border:none;color:var(--text);font-size:13px;text-align:left;padding:7px 12px;border-radius:8px;cursor:pointer;display:flex;gap:8px;align-items:center;white-space:nowrap;width:100%';
    btn.onmouseover = () => btn.style.background = 'var(--surface3)';
    btn.onmouseout = () => btn.style.background = 'none';
    btn.innerHTML = `${icon} ${label}`;
    btn.onclick = (e) => { e.stopPropagation(); fn(); popup.remove(); };
    popup.appendChild(btn);
  });
  const rect = btn.getBoundingClientRect();
  popup.style.cssText += `;position:fixed;right:${window.innerWidth - rect.right}px;top:${rect.bottom + 4}px`;
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 10);
}

async function deletePost(postId) {
  if (!confirm('Delete this post?')) return;
  const data = await api('DELETE', `/posts/${postId}`);
  if (!data) return;
  document.querySelector(`[data-post-id="${postId}"]`)?.remove();
  showToast('Post deleted.');
}

function sharePost(postId) {
  navigator.clipboard?.writeText(`${window.location.origin}/app.html?post=${postId}`).catch(()=>{});
  showToast('Link copied! 🔗');
}

// ─── COMPOSER ─────────────────────────────────────────────────────────────────
function toggleType(type) {
  if (postType === type) {
    postType = 'normal';
    ['joke','study','event'].forEach(t => document.getElementById(`btn${t.charAt(0).toUpperCase()+t.slice(1)}`)?.classList.remove('active-type'));
  } else {
    postType = type;
    ['joke','study','event'].forEach(t => {
      const btn = document.getElementById(`btn${t.charAt(0).toUpperCase()+t.slice(1)}`);
      btn?.classList.toggle('active-type', t === type);
    });
  }
}

function pickFile() { document.getElementById('fileInput').click(); }

function onFileChange(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    imgData = ev.target.result;
    document.getElementById('composerImgPreview').src = imgData;
    document.getElementById('composerImgWrap').style.display = 'block';
  };
  reader.readAsDataURL(file);
}

function clearImg() {
  imgData = null;
  document.getElementById('composerImgWrap').style.display = 'none';
  document.getElementById('fileInput').value = '';
}

async function publishPost() {
  const text = document.getElementById('composerText').value.trim();
  if (!text && !imgData) return showToast('Write something first! ✍️');
  const data = await api('POST', '/posts', { text, image_data: imgData || '', post_type: postType });
  if (!data) return;
  document.getElementById('composerText').value = '';
  clearImg();
  postType = 'normal';
  ['Joke','Study','Event'].forEach(t => document.getElementById(`btn${t}`)?.classList.remove('active-type'));
  const card = buildPostCard(data.post);
  const container = document.getElementById('feedPosts');
  // Remove empty state if present
  container.querySelector('.empty')?.remove();
  container.prepend(card);
  showToast('Posted! 🎉');
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function openMyProfile() { openProfile(currentUser.id); }

async function openProfile(userId) {
  const data = await api('GET', `/users/${userId}`);
  if (!data) return;
  const user = data.user;
  const isMe = user.id === currentUser.id;

  document.getElementById('profileName').textContent = user.name;
  document.getElementById('profileSid').textContent = user.student_id;
  document.getElementById('profileDept').textContent = user.department || '';
  document.getElementById('profileDept').style.display = user.department ? '' : 'none';
  document.getElementById('profileYear').textContent = user.year || '';
  document.getElementById('profileYear').style.display = user.year ? '' : 'none';
  document.getElementById('profileBio').textContent = user.bio || 'No bio yet.';
  document.getElementById('psPosts').textContent = user.post_count || 0;
  document.getElementById('psFriends').textContent = user.friend_count || 0;
  document.getElementById('psLikes').textContent = user.like_count || 0;

  // Cover
  const cover = document.getElementById('profileCover');
  cover.style.background = `linear-gradient(135deg,${user.avatar_color||'#5b6af5'},${shiftColor(user.avatar_color)})`;

  // Avatar
  const avEl2 = document.getElementById('profileAv');
  avEl2.style.background = user.avatar_color || '#5b6af5';
  avEl2.style.width = '76px'; avEl2.style.height = '76px'; avEl2.style.fontSize = '26px';
  avEl2.textContent = initials(user.name);

  // Actions
  const actions = document.getElementById('profileActions');
  if (isMe) {
    actions.innerHTML = `<button class="btn-edit" onclick="openEditProfile()">✏️ Edit Profile</button>`;
  } else {
    const fr = allUsers.find(u => u.id === userId);
    const status = fr?.friendship || 'none';
    const btnClass = status === 'pending' ? 'pending' : status === 'accepted' ? 'friends' : '';
    const btnText = status === 'accepted' ? '✓ Friends' : status === 'pending' ? '⏳ Pending' : '+ Add Friend';
    actions.innerHTML = `<button class="btn-add ${btnClass}" onclick="sendFriendReq('${userId}',this)" ${status!=='none'?'disabled':''}>${btnText}</button>`;
  }

  // Posts grid (photos only)
  const postsData = await api('GET', `/posts?author_id=${userId}&limit=9`);
  const grid = document.getElementById('profilePostsGrid');
  const imgPosts = (postsData?.posts || []).filter(p => p.image_data);
  if (imgPosts.length) {
    grid.innerHTML = imgPosts.map(p => `<img src="${p.image_data}" onclick="openLightbox('${p.image_data}')" loading="lazy">`).join('');
  } else {
    grid.innerHTML = '';
  }

  openModal('profileModal');
}

function shiftColor(hex) {
  // Complementary-ish color shift
  const colors = ['#5b6af5','#f05fa9','#00e0b8','#ffa94d','#a29bfe','#fd79a8'];
  const i = colors.indexOf(hex);
  return colors[(i + 2) % colors.length] || '#f05fa9';
}

function openEditProfile() {
  document.getElementById('editName').value = currentUser.name;
  document.getElementById('editBio').value = currentUser.bio || '';
  document.getElementById('editDept').value = currentUser.department || '';
  document.getElementById('editYear').value = currentUser.year || '';
  closeModal('profileModal');
  openModal('editModal');
}

async function saveProfile() {
  const data = await api('PUT', '/users/me', {
    name: document.getElementById('editName').value.trim(),
    bio:  document.getElementById('editBio').value.trim(),
    department: document.getElementById('editDept').value,
    year: document.getElementById('editYear').value,
  });
  if (!data) return;
  currentUser = { ...currentUser, ...data.user };
  localStorage.setItem('cc_user', JSON.stringify(currentUser));
  renderSelfUI();
  closeModal('editModal');
  showToast('Profile updated! ✅');
}

// ─── FRIENDS ──────────────────────────────────────────────────────────────────
let friendsTabActive = 'all';
let friendRequests = [];

async function friendsTab(tab, btn) {
  friendsTabActive = tab;
  document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
  btn?.classList.add('active');
  await loadFriendsContent();
}

async function loadFriendRequests() {
  const data = await api('GET', '/friend-requests');
  friendRequests = data?.requests || [];
  const badge = document.getElementById('reqCount');
  if (badge) badge.textContent = friendRequests.length ? `(${friendRequests.length})` : '';
}

async function searchPeople() {
  const q = document.getElementById('peopleSearch')?.value || '';
  await fetchUsers();
  await loadFriendsContent(q);
}

async function loadFriendsContent(searchQ = '') {
  const el = document.getElementById('friendsTabContent');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';

  if (friendsTabActive === 'requests') {
    await loadFriendRequests();
    if (!friendRequests.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">📨</div><div class="empty-title">No pending requests</div></div>`;
      return;
    }
    el.innerHTML = friendRequests.map(r => `
      <div class="person-card">
        ${avHtml({name:r.name, avatar_color:r.avatar_color}, 48, `onclick="openProfile('${r.requester_id}')" style="cursor:pointer"`)}
        <div class="person-info">
          <div class="person-name" onclick="openProfile('${r.requester_id}')">${esc(r.name)}</div>
          <div class="person-sub">${r.student_id} · ${DEPT_SHORT[r.department]||r.department||''}</div>
        </div>
        <div class="person-actions">
          <button class="btn-accept" onclick="respondFriend('${r.id}','accept',this)">Accept</button>
          <button class="btn-decline" onclick="respondFriend('${r.id}','decline',this)">Decline</button>
        </div>
      </div>`).join('');
    return;
  }

  if (friendsTabActive === 'myfriends') {
    const data = await api('GET', '/friends');
    const friends = data?.friends || [];
    if (!friends.length) {
      el.innerHTML = `<div class="empty"><div class="empty-icon">👥</div><div class="empty-title">No friends yet</div><div class="empty-sub">Start adding classmates!</div></div>`;
      return;
    }
    el.innerHTML = friends.map(u => `
      <div class="person-card">
        ${avHtml(u, 48, `onclick="openProfile('${u.id}')" style="cursor:pointer"`)}
        <div class="person-info">
          <div class="person-name" onclick="openProfile('${u.id}')">${esc(u.name)}</div>
          <div class="person-sub">${u.student_id} · ${DEPT_SHORT[u.department]||u.department||''}</div>
        </div>
        <button class="btn-add friends" disabled>✓ Friends</button>
      </div>`).join('');
    return;
  }

  // All users
  let show = allUsers;
  if (searchQ) show = show.filter(u => u.name.toLowerCase().includes(searchQ.toLowerCase()) || u.student_id.includes(searchQ));
  if (!show.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><div class="empty-title">No students found</div></div>`;
    return;
  }
  el.innerHTML = show.map(u => {
    const s = u.friendship;
    const btnCls = s === 'accepted' ? 'friends' : s === 'pending' ? 'pending' : '';
    const btnTxt = s === 'accepted' ? '✓ Friends' : s === 'pending' ? '⏳ Pending' : '+ Add Friend';
    return `<div class="person-card">
      ${avHtml(u, 48, `onclick="openProfile('${u.id}')" style="cursor:pointer"`)}
      <div class="person-info">
        <div class="person-name" onclick="openProfile('${u.id}')">${esc(u.name)}</div>
        <div class="person-sub">${u.student_id} · ${DEPT_SHORT[u.department]||u.department||''} · ${u.year||''}</div>
      </div>
      <button class="btn-add ${btnCls}" onclick="sendFriendReq('${u.id}',this)" ${s!=='none'?'disabled':''}>${btnTxt}</button>
    </div>`;
  }).join('');
}

async function sendFriendReq(userId, btn) {
  btn && (btn.disabled = true, btn.textContent = '⏳ Pending', btn.classList.add('pending'));
  const data = await api('POST', '/friends/request', { user_id: userId });
  if (!data) return;
  showToast('Friend request sent! 👋');
  await fetchUsers();
}

async function respondFriend(reqId, action, btn) {
  const data = await api('POST', `/friends/${reqId}/respond`, { action });
  if (!data) return;
  showToast(action === 'accept' ? 'Friend request accepted! 🎉' : 'Request declined.');
  btn.closest('.person-card')?.remove();
  await fetchUsers();
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
const NOTIF_ICONS = { like:'❤️', comment:'💬', friend_request:'👥', friend_accept:'🎉' };

async function loadNotifCount() {
  const data = await api('GET', '/notifications');
  if (!data) return;
  const cnt = data.unread || 0;
  const badges = [document.getElementById('navNotifBadge'), document.getElementById('notifBadgeBtn')];
  badges.forEach(b => { if (!b) return; b.textContent = cnt; b.style.display = cnt ? '' : 'none'; });
}

async function loadNotifications() {
  const el = document.getElementById('notifList');
  el.innerHTML = '<div class="spinner"></div>';
  const data = await api('GET', '/notifications');
  if (!data) return;
  await api('POST', '/notifications/read');
  // Clear badges
  [document.getElementById('navNotifBadge'), document.getElementById('notifBadgeBtn')]
    .forEach(b => b && (b.style.display = 'none'));

  const notifs = data.notifications || [];
  if (!notifs.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔔</div><div class="empty-title">All caught up!</div><div class="empty-sub">No new notifications.</div></div>`;
    return;
  }
  el.innerHTML = notifs.map(n => `
    <div class="notif-card${n.is_read?'':' unread'}">
      <div class="notif-icon">${NOTIF_ICONS[n.type] || '📣'}</div>
      <div class="notif-text">
        <div class="notif-msg"><strong>${esc(n.actor_name||'Someone')}</strong> ${esc(n.message?.replace(n.actor_name||'', '')||'')}</div>
        <div class="notif-time">${n.time_ago}</div>
      </div>
    </div>`).join('');
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
async function loadEvents() {
  const el = document.getElementById('eventsList');
  el.innerHTML = '<div class="spinner"></div>';
  const data = await api('GET', '/events');
  if (!data?.events?.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📅</div><div class="empty-title">No events yet</div></div>';
    return;
  }
  el.innerHTML = data.events.map(e => `
    <div class="event-card" style="border-left-color:${e.color}">
      <div class="event-body">
        <div class="event-title">${esc(e.title)}</div>
        <div class="event-meta">
          <span>📅 ${esc(e.date_str||'')}</span>
          <span>📍 ${esc(e.location||'')}</span>
        </div>
        <div class="event-desc">${esc(e.description||'')}</div>
        <div class="event-actions">
          <button class="btn-register" onclick="this.textContent='✓ Registered!';this.style.background='var(--accent3)';showToast('Registered for ${esc(e.title)}! 🎉')">Register Now</button>
          <button class="btn-ghost" onclick="showToast('Event shared! 🔗')">Share</button>
        </div>
      </div>
    </div>`).join('');
}

// ─── JOKES ────────────────────────────────────────────────────────────────────
const STATIC_JOKES = [
  { text: "Why do programmers prefer dark mode?\n\nBecause light attracts bugs! 🐛", author: 'Alex Rahman', color: '#5b6af5', dept: 'CSE' },
  { text: "An SQL query walks into a bar, walks up to two tables and asks...\n\n'Can I JOIN you?' 🤣", author: 'Tariq Malik', color: '#a29bfe', dept: 'MATH' },
  { text: "Why did the math book look so sad?\n\nBecause it had too many problems! 📚😂", author: 'Rina Chowdhury', color: '#ff9f43', dept: 'PHY' },
  { text: "My WiFi password is 'incorrect'.\n\nSo when people ask me what it is, I say 'incorrect' 😂", author: 'Priya Das', color: '#f05fa9', dept: 'EEE' },
  { text: "Engineering students be like:\n\n8AM: I'll sleep early tonight\n8PM: Let me just finish this one assignment\n4AM: 😭", author: 'Jamal Hossain', color: '#00e0b8', dept: 'BBA' },
];

async function loadJokes() {
  const el = document.getElementById('jokesList');
  el.innerHTML = '<div class="spinner"></div>';
  // Load joke-type posts + static jokes
  const data = await api('GET', '/posts?type=joke');
  const posts = data?.posts || [];

  let html = posts.map(p => `
    <div class="joke-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        ${avHtml(p.author, 36, `onclick="openProfile('${p.author?.id}')" style="cursor:pointer"`)}
        <div>
          <div style="font-weight:600;font-size:14px">${esc(p.author?.name||'')}</div>
          <div class="joke-meta" style="margin:0">${p.time_ago}</div>
        </div>
      </div>
      <div class="joke-text">${esc(p.text)}</div>
      <div style="display:flex;gap:10px;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <button class="pf-btn" style="flex:none;padding:7px 14px;border-radius:9px;background:var(--surface2);border:1px solid var(--border)" onclick="likePost('${p.id}',this)">
          <span class="pf-icon">${p.liked?'❤️':'🤍'}</span> ${p.like_count||0}
        </button>
        <button class="pf-btn" style="flex:none;padding:7px 14px;border-radius:9px;background:var(--surface2);border:1px solid var(--border)" onclick="showToast('😂 Ha!')">😂 Funny</button>
      </div>
    </div>`).join('');

  html += STATIC_JOKES.map(j => `
    <div class="joke-card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <div class="av" style="width:36px;height:36px;font-size:13px;background:${j.color};border-radius:50%">${j.author.split(' ').map(w=>w[0]).join('')}</div>
        <div>
          <div style="font-weight:600;font-size:14px">${j.author}</div>
          <div class="joke-meta" style="margin:0">${j.dept} · Classic</div>
        </div>
      </div>
      <div class="joke-text">${j.text}</div>
      <div style="display:flex;gap:10px;margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
        <button class="pf-btn" style="flex:none;padding:7px 14px;border-radius:9px;background:var(--surface2);border:1px solid var(--border)" onclick="showToast('😂 Ha!')">😂 Funny</button>
      </div>
    </div>`).join('');

  el.innerHTML = html || '<div class="empty"><div class="empty-icon">😂</div><div class="empty-title">No jokes yet</div><div class="empty-sub">Post a joke to the feed!</div></div>';
}

// ─── EXPLORE ──────────────────────────────────────────────────────────────────
let allPosts = [];
async function loadExplore() {
  const el = document.getElementById('exploreGrid');
  el.innerHTML = '<div class="spinner"></div>';
  const data = await api('GET', '/posts?limit=50');
  allPosts = data?.posts || [];
  filterExplore();
}

function filterExplore() {
  const el = document.getElementById('exploreGrid');
  const q = document.getElementById('exploreInp')?.value.toLowerCase() || '';
  const filtered = allPosts.filter(p => !q || p.text?.toLowerCase().includes(q) || p.author?.name?.toLowerCase().includes(q));
  if (!filtered.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🔭</div><div class="empty-title">Nothing found</div></div>';
    return;
  }
  el.innerHTML = filtered.map(p => {
    if (p.image_data) {
      return `<img class="explore-item" src="${p.image_data}" onclick="openLightbox('${p.image_data}')" loading="lazy">`;
    }
    return `<div class="explore-post">
      <div class="explore-post-author">${esc(p.author?.name||'')} · ${DEPT_SHORT[p.author?.department]||''}</div>
      <div class="explore-post-text">${esc(p.text||'')}</div>
    </div>`;
  }).join('');
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ─── LIGHTBOX ─────────────────────────────────────────────────────────────────
function openLightbox(src) {
  document.getElementById('lbImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('open')); } });

// ─── TOAST ────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── POST MODAL ───────────────────────────────────────────────────────────────
async function openPostModal(postId) {
  currentPostId = postId;
  document.getElementById('postModalContent').innerHTML = '<div class="spinner"></div>';
  document.getElementById('postModalComments').innerHTML = '';
  openModal('postModal');
  const data = await api('GET', `/posts/${postId}`);
  if (!data) return;
  const card = buildPostCard(data.post);
  card.style.borderRadius = '0';
  card.style.border = 'none';
  card.style.marginBottom = '0';
  document.getElementById('postModalContent').innerHTML = '';
  document.getElementById('postModalContent').appendChild(card);
  document.getElementById('postModalComments').innerHTML = (data.comments||[]).map(c => commentHtml(c)).join('');
}

async function submitComment() {
  if (!currentPostId) return;
  const inp = document.getElementById('commentInp');
  const text = inp?.value.trim(); if (!text) return;
  const data = await api('POST', `/posts/${currentPostId}/comments`, { text });
  if (!data) return;
  inp.value = '';
  document.getElementById('postModalComments').insertAdjacentHTML('beforeend', commentHtml(data.comment));
}
