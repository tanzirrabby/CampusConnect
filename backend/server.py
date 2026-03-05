#!/usr/bin/env python3
"""
CampusConnect Backend — Python HTTP Server + SQLite
Full REST API: Auth, Posts, Comments, Likes, Reactions, Friends, Notifications, Profile
"""

import json, sqlite3, hashlib, hmac, base64, uuid, time, os, re, urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import datetime, timedelta

PORT = 8000
# Resolve absolute paths so server works regardless of where it's launched from
_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)           # campusconnect/
DB_PATH = os.path.join(_HERE, 'campusconnect.db')
FRONTEND_DIR = os.path.join(_ROOT, 'frontend')
SECRET = 'campus_secret_key_2025_very_secure'

# ─── JWT (minimal, no deps) ───────────────────────────────────────────────────
def b64encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()

def b64decode(s):
    s += '=' * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)

def jwt_create(payload):
    payload['exp'] = int(time.time()) + 86400 * 7  # 7 days
    header = b64encode(json.dumps({'alg':'HS256','typ':'JWT'}).encode())
    body   = b64encode(json.dumps(payload).encode())
    sig    = b64encode(hmac.new(SECRET.encode(), f'{header}.{body}'.encode(), hashlib.sha256).digest())
    return f'{header}.{body}.{sig}'

def jwt_verify(token):
    try:
        parts = token.split('.')
        if len(parts) != 3: return None
        header, body, sig = parts
        expected = b64encode(hmac.new(SECRET.encode(), f'{header}.{body}'.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected): return None
        payload = json.loads(b64decode(body))
        if payload.get('exp', 0) < time.time(): return None
        return payload
    except: return None

def hash_password(pw):
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000)
    return base64.b64encode(salt + dk).decode()

def check_password(pw, stored):
    data = base64.b64decode(stored)
    salt, dk = data[:16], data[16:]
    return hmac.compare_digest(dk, hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 100000))

# ─── DATABASE ─────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn

def init_db():
    with get_db() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            student_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            department TEXT NOT NULL,
            bio TEXT DEFAULT '',
            password TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#6c63ff',
            avatar_url TEXT DEFAULT '',
            year TEXT DEFAULT '',
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS posts (
            id TEXT PRIMARY KEY,
            author_id TEXT NOT NULL,
            text TEXT NOT NULL,
            image_data TEXT DEFAULT '',
            post_type TEXT DEFAULT 'normal',
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY(author_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS likes (
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            PRIMARY KEY(post_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS reactions (
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            emoji TEXT NOT NULL,
            PRIMARY KEY(post_id, user_id)
        );
        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            post_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            text TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s','now')),
            FOREIGN KEY(post_id) REFERENCES posts(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS friendships (
            id TEXT PRIMARY KEY,
            requester_id TEXT NOT NULL,
            addressee_id TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            type TEXT NOT NULL,
            entity_id TEXT DEFAULT '',
            message TEXT DEFAULT '',
            is_read INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            date_str TEXT,
            location TEXT,
            color TEXT DEFAULT '#6c63ff',
            organizer_id TEXT,
            created_at INTEGER DEFAULT (strftime('%s','now'))
        );
        """)
        # Seed demo users
        users = db.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
        if users == 0:
            demo = [
                ('STU-2024-0001','Alex Rahman','Computer Science & Engineering','CS nerd | Open source contributor | Coffee addict ☕','#6c63ff'),
                ('STU-2024-0002','Priya Das','Electrical Engineering','EEE enthusiast | Robotics club president 🤖','#ff6b9d'),
                ('STU-2024-0003','Jamal Hossain','Business Administration','BBA | Startup dreamer | Chess player ♟️','#00d4aa'),
                ('STU-2024-0004','Rina Chowdhury','Physics','Quantum physics obsessed | Part-time stargazer 🌌','#ff9f43'),
                ('STU-2024-0005','Tariq Malik','Mathematics','Math tutor | Problem solver | Tea > Coffee 🍵','#a29bfe'),
            ]
            for sid, name, dept, bio, color in demo:
                uid = str(uuid.uuid4())
                db.execute("INSERT INTO users(id,student_id,name,department,bio,password,avatar_color) VALUES(?,?,?,?,?,?,?)",
                           (uid, sid, name, dept, bio, hash_password('pass123'), color))
            # Seed posts
            users_rows = db.execute("SELECT id,student_id FROM users").fetchall()
            uid_map = {r['student_id']: r['id'] for r in users_rows}
            t = int(time.time())
            seed_posts = [
                (uid_map['STU-2024-0001'], "Just pushed my final year project to GitHub 🚀 Three months of sleepless nights finally paid off! #FinalYearProject #CSE", 'normal', t-3600),
                (uid_map['STU-2024-0002'], "Why do programmers prefer dark mode?\n\nBecause light attracts bugs! 🐛😂 #JokeCorner", 'joke', t-7200),
                (uid_map['STU-2024-0003'], "📢 CAMPUS EVENT: Startup Pitch Competition this Friday at the Main Auditorium! 💼 Prizes up to ৳50,000. Register at the student portal! #Startup", 'event', t-86400),
                (uid_map['STU-2024-0004'], "Aced my Quantum Mechanics exam after pulling an all-nighter studying with Tariq! The canteen chai kept us alive ☕🧪 #StudyBuddy", 'study', t-172800),
                (uid_map['STU-2024-0005'], "Pro tip: If you're stuck on a math problem, go for a walk. Your brain solves it in the background 🧠✨ Happened to me 3 times this week! #MathLife", 'normal', t-259200),
            ]
            for author, text, ptype, ts in seed_posts:
                db.execute("INSERT INTO posts(id,author_id,text,post_type,created_at) VALUES(?,?,?,?,?)",
                           (str(uuid.uuid4()), author, text, ptype, ts))
            # Seed events
            events_data = [
                ('Annual Hackathon 2025','48-hour coding marathon. Form teams of 3–5. Prizes up to ৳1,00,000!','March 15–16, 2025','CSE Building, Lab 301','#6c63ff'),
                ('Cultural Night','Music, dance, drama by students. Free entry with student ID.','March 20, 2025','Central Auditorium','#ff6b9d'),
                ('Startup Pitch Competition','Pitch your idea to real investors. Register at student portal.','March 22, 2025','Main Auditorium','#00d4aa'),
                ('Mid-Term Study Fest','Extended library hours, group study sessions, free coffee!','April 1–5, 2025','Library & Rooms 201–210','#ff9f43'),
                ('Inter-Dept Sports Gala','Football, cricket, badminton. Register your department team now!','April 10, 2025','University Ground','#a29bfe'),
            ]
            for title, desc, date, loc, color in events_data:
                db.execute("INSERT INTO events(id,title,description,date_str,location,color) VALUES(?,?,?,?,?,?)",
                           (str(uuid.uuid4()), title, desc, date, loc, color))
            db.commit()

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def time_ago(ts):
    diff = int(time.time()) - int(ts)
    if diff < 60: return 'just now'
    if diff < 3600: return f'{diff//60}m ago'
    if diff < 86400: return f'{diff//3600}h ago'
    return f'{diff//86400}d ago'

def row_to_dict(row):
    return dict(row) if row else None

def user_public(u):
    if not u: return None
    d = dict(u)
    d.pop('password', None)
    return d

def get_post_full(db, post_id, current_user_id):
    post = db.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    if not post: return None
    post = dict(post)
    author = db.execute("SELECT * FROM users WHERE id=?", (post['author_id'],)).fetchone()
    post['author'] = user_public(author)
    post['like_count'] = db.execute("SELECT COUNT(*) as c FROM likes WHERE post_id=?", (post_id,)).fetchone()['c']
    post['liked'] = bool(db.execute("SELECT 1 FROM likes WHERE post_id=? AND user_id=?", (post_id, current_user_id)).fetchone())
    # Reactions per emoji
    rxns = db.execute("SELECT emoji, GROUP_CONCAT(user_id) as users, COUNT(*) as cnt FROM reactions WHERE post_id=? GROUP BY emoji", (post_id,)).fetchall()
    post['reactions'] = {}
    for r in rxns:
        users_list = r['users'].split(',') if r['users'] else []
        post['reactions'][r['emoji']] = {'count': r['cnt'], 'reacted': current_user_id in users_list}
    post['comment_count'] = db.execute("SELECT COUNT(*) as c FROM comments WHERE post_id=?", (post_id,)).fetchone()['c']
    post['time_ago'] = time_ago(post['created_at'])
    return post

def get_comments(db, post_id):
    rows = db.execute("SELECT c.*, u.name, u.avatar_color, u.student_id FROM comments c JOIN users u ON c.user_id=u.id WHERE c.post_id=? ORDER BY c.created_at ASC", (post_id,)).fetchall()
    return [dict(r) for r in rows]

# ─── HTTP HANDLER ─────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"  {self.command} {self.path} → {args[1] if len(args)>1 else ''}")

    def send_json(self, data, status=200):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
        self.end_headers()
        self.wfile.write(body)

    def send_err(self, msg, status=400):
        self.send_json({'error': msg}, status)

    def get_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length == 0: return {}
        raw = self.rfile.read(length)
        try: return json.loads(raw)
        except: return {}

    def get_current_user(self, db):
        auth = self.headers.get('Authorization', '')
        if not auth.startswith('Bearer '): return None
        token = auth[7:]
        payload = jwt_verify(token)
        if not payload: return None
        user = db.execute("SELECT * FROM users WHERE id=?", (payload['user_id'],)).fetchone()
        return dict(user) if user else None

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        qs = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))

        # Serve frontend static files
        if path == '/' or not path.startswith('/api/'):
            self.serve_static(path)
            return

        with get_db() as db:
            me = self.get_current_user(db)

            # ── Posts feed
            if path == '/api/posts':
                if not me: return self.send_err('Unauthorized', 401)
                filter_type = qs.get('type', '')
                author_id = qs.get('author_id', '')
                limit = int(qs.get('limit', 20))
                offset = int(qs.get('offset', 0))
                q = qs.get('q', '')
                sql = "SELECT id FROM posts WHERE 1=1"
                params = []
                if filter_type: sql += " AND post_type=?"; params.append(filter_type)
                if author_id:   sql += " AND author_id=?"; params.append(author_id)
                if q:           sql += " AND text LIKE ?"; params.append(f'%{q}%')
                sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
                params += [limit, offset]
                ids = [r['id'] for r in db.execute(sql, params).fetchall()]
                posts = [get_post_full(db, pid, me['id']) for pid in ids]
                return self.send_json({'posts': posts, 'total': len(ids)})

            # ── Single post
            if re.match(r'^/api/posts/([^/]+)$', path):
                pid = path.split('/')[-1]
                if not me: return self.send_err('Unauthorized', 401)
                post = get_post_full(db, pid, me['id'])
                if not post: return self.send_err('Not found', 404)
                comments = get_comments(db, pid)
                return self.send_json({'post': post, 'comments': comments})

            # ── Users list
            if path == '/api/users':
                if not me: return self.send_err('Unauthorized', 401)
                q = qs.get('q', '')
                rows = db.execute("SELECT * FROM users WHERE (name LIKE ? OR student_id LIKE ?) AND id != ?",
                                  (f'%{q}%', f'%{q}%', me['id'])).fetchall()
                users = [user_public(r) for r in rows]
                # Add friendship status
                for u in users:
                    fr = db.execute("SELECT status FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
                                    (me['id'], u['id'], u['id'], me['id'])).fetchone()
                    u['friendship'] = fr['status'] if fr else 'none'
                return self.send_json({'users': users})

            # ── Single user profile
            if re.match(r'^/api/users/([^/]+)$', path):
                uid = path.split('/')[-1]
                if not me: return self.send_err('Unauthorized', 401)
                if uid == 'me': uid = me['id']
                user = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
                if not user: return self.send_err('Not found', 404)
                user = user_public(user)
                user['post_count'] = db.execute("SELECT COUNT(*) as c FROM posts WHERE author_id=?", (uid,)).fetchone()['c']
                user['friend_count'] = db.execute("SELECT COUNT(*) as c FROM friendships WHERE (requester_id=? OR addressee_id=?) AND status='accepted'", (uid,uid)).fetchone()['c']
                user['like_count'] = db.execute("SELECT COUNT(*) as c FROM likes l JOIN posts p ON l.post_id=p.id WHERE p.author_id=?", (uid,)).fetchone()['c']
                return self.send_json({'user': user})

            # ── Notifications
            if path == '/api/notifications':
                if not me: return self.send_err('Unauthorized', 401)
                rows = db.execute("""SELECT n.*, u.name as actor_name, u.avatar_color as actor_color
                    FROM notifications n LEFT JOIN users u ON n.actor_id=u.id
                    WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 30""", (me['id'],)).fetchall()
                notifs = [dict(r) for r in rows]
                for n in notifs: n['time_ago'] = time_ago(n['created_at'])
                unread = db.execute("SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0", (me['id'],)).fetchone()['c']
                return self.send_json({'notifications': notifs, 'unread': unread})

            # ── Events
            if path == '/api/events':
                if not me: return self.send_err('Unauthorized', 401)
                rows = db.execute("SELECT * FROM events ORDER BY created_at DESC").fetchall()
                return self.send_json({'events': [dict(r) for r in rows]})

            # ── Friends
            if path == '/api/friends':
                if not me: return self.send_err('Unauthorized', 401)
                rows = db.execute("""SELECT u.* FROM users u
                    JOIN friendships f ON (f.requester_id=u.id OR f.addressee_id=u.id)
                    WHERE (f.requester_id=? OR f.addressee_id=?) AND f.status='accepted' AND u.id!=?""",
                    (me['id'], me['id'], me['id'])).fetchall()
                return self.send_json({'friends': [user_public(r) for r in rows]})

            # ── Friend requests
            if path == '/api/friend-requests':
                if not me: return self.send_err('Unauthorized', 401)
                rows = db.execute("""SELECT f.*, u.name, u.avatar_color, u.department, u.student_id FROM friendships f
                    JOIN users u ON f.requester_id=u.id
                    WHERE f.addressee_id=? AND f.status='pending'""", (me['id'],)).fetchall()
                return self.send_json({'requests': [dict(r) for r in rows]})

            return self.send_err('Not found', 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        body = self.get_body()

        with get_db() as db:
            # ── Register
            if path == '/api/auth/register':
                name = body.get('name','').strip()
                sid  = body.get('student_id','').strip().upper()
                dept = body.get('department','').strip()
                bio  = body.get('bio','').strip()
                pw   = body.get('password','')
                year = body.get('year','').strip()
                if not all([name, sid, dept, pw]):
                    return self.send_err('All fields required')
                if len(pw) < 6:
                    return self.send_err('Password must be at least 6 characters')
                if db.execute("SELECT 1 FROM users WHERE student_id=?", (sid,)).fetchone():
                    return self.send_err('Student ID already registered')
                uid = str(uuid.uuid4())
                colors = ['#6c63ff','#ff6b9d','#00d4aa','#ff9f43','#a29bfe','#fd79a8','#00cec9']
                color = colors[len(db.execute("SELECT id FROM users").fetchall()) % len(colors)]
                db.execute("INSERT INTO users(id,student_id,name,department,bio,password,avatar_color,year) VALUES(?,?,?,?,?,?,?,?)",
                           (uid, sid, name, dept, bio, hash_password(pw), color, year))
                db.commit()
                token = jwt_create({'user_id': uid})
                user = user_public(db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())
                return self.send_json({'token': token, 'user': user}, 201)

            # ── Login
            if path == '/api/auth/login':
                sid = body.get('student_id','').strip().upper()
                pw  = body.get('password','')
                user = db.execute("SELECT * FROM users WHERE student_id=?", (sid,)).fetchone()
                if not user or not check_password(pw, user['password']):
                    return self.send_err('Invalid Student ID or password', 401)
                token = jwt_create({'user_id': user['id']})
                return self.send_json({'token': token, 'user': user_public(user)})

            # All below require auth
            me = self.get_current_user(db)
            if not me: return self.send_err('Unauthorized', 401)

            # ── Create post
            if path == '/api/posts':
                text = body.get('text','').strip()
                img  = body.get('image_data','')
                ptype= body.get('post_type','normal')
                if not text and not img:
                    return self.send_err('Post content required')
                pid = str(uuid.uuid4())
                db.execute("INSERT INTO posts(id,author_id,text,image_data,post_type) VALUES(?,?,?,?,?)",
                           (pid, me['id'], text, img, ptype))
                db.commit()
                post = get_post_full(db, pid, me['id'])
                return self.send_json({'post': post}, 201)

            # ── Like post
            if re.match(r'^/api/posts/([^/]+)/like$', path):
                pid = path.split('/')[-2]
                existing = db.execute("SELECT 1 FROM likes WHERE post_id=? AND user_id=?", (pid, me['id'])).fetchone()
                if existing:
                    db.execute("DELETE FROM likes WHERE post_id=? AND user_id=?", (pid, me['id']))
                    liked = False
                else:
                    db.execute("INSERT INTO likes(post_id, user_id) VALUES(?,?)", (pid, me['id']))
                    # Notify post author
                    post_author = db.execute("SELECT author_id FROM posts WHERE id=?", (pid,)).fetchone()
                    if post_author and post_author['author_id'] != me['id']:
                        db.execute("INSERT INTO notifications(id,user_id,actor_id,type,entity_id,message) VALUES(?,?,?,?,?,?)",
                                   (str(uuid.uuid4()), post_author['author_id'], me['id'], 'like', pid, f"{me['name']} liked your post"))
                    liked = True
                db.commit()
                count = db.execute("SELECT COUNT(*) as c FROM likes WHERE post_id=?", (pid,)).fetchone()['c']
                return self.send_json({'liked': liked, 'count': count})

            # ── React to post
            if re.match(r'^/api/posts/([^/]+)/react$', path):
                pid   = path.split('/')[-2]
                emoji = body.get('emoji','')
                if not emoji: return self.send_err('Emoji required')
                existing = db.execute("SELECT emoji FROM reactions WHERE post_id=? AND user_id=?", (pid, me['id'])).fetchone()
                if existing and existing['emoji'] == emoji:
                    db.execute("DELETE FROM reactions WHERE post_id=? AND user_id=?", (pid, me['id']))
                    reacted = False
                else:
                    db.execute("INSERT OR REPLACE INTO reactions(post_id,user_id,emoji) VALUES(?,?,?)", (pid, me['id'], emoji))
                    reacted = True
                db.commit()
                rxns = db.execute("SELECT emoji, COUNT(*) as cnt FROM reactions WHERE post_id=? GROUP BY emoji", (pid,)).fetchall()
                return self.send_json({'reacted': reacted, 'emoji': emoji, 'reactions': {r['emoji']:r['cnt'] for r in rxns}})

            # ── Comment
            if re.match(r'^/api/posts/([^/]+)/comments$', path):
                pid  = path.split('/')[-2]
                text = body.get('text','').strip()
                if not text: return self.send_err('Comment text required')
                cid = str(uuid.uuid4())
                db.execute("INSERT INTO comments(id,post_id,user_id,text) VALUES(?,?,?,?)", (cid, pid, me['id'], text))
                post_author = db.execute("SELECT author_id FROM posts WHERE id=?", (pid,)).fetchone()
                if post_author and post_author['author_id'] != me['id']:
                    db.execute("INSERT INTO notifications(id,user_id,actor_id,type,entity_id,message) VALUES(?,?,?,?,?,?)",
                               (str(uuid.uuid4()), post_author['author_id'], me['id'], 'comment', pid, f"{me['name']} commented on your post"))
                db.commit()
                comment = db.execute("SELECT c.*, u.name, u.avatar_color, u.student_id FROM comments c JOIN users u ON c.user_id=u.id WHERE c.id=?", (cid,)).fetchone()
                return self.send_json({'comment': dict(comment)}, 201)

            # ── Send friend request
            if path == '/api/friends/request':
                target_id = body.get('user_id','')
                if target_id == me['id']: return self.send_err('Cannot friend yourself')
                existing = db.execute("SELECT id,status FROM friendships WHERE (requester_id=? AND addressee_id=?) OR (requester_id=? AND addressee_id=?)",
                                      (me['id'], target_id, target_id, me['id'])).fetchone()
                if existing:
                    return self.send_json({'status': existing['status'], 'message': 'Already exists'})
                fid = str(uuid.uuid4())
                db.execute("INSERT INTO friendships(id,requester_id,addressee_id) VALUES(?,?,?)", (fid, me['id'], target_id))
                db.execute("INSERT INTO notifications(id,user_id,actor_id,type,entity_id,message) VALUES(?,?,?,?,?,?)",
                           (str(uuid.uuid4()), target_id, me['id'], 'friend_request', fid, f"{me['name']} sent you a friend request"))
                db.commit()
                return self.send_json({'status': 'pending'}, 201)

            # ── Accept/decline friend request
            if re.match(r'^/api/friends/([^/]+)/respond$', path):
                fid    = path.split('/')[-2]
                action = body.get('action','')
                fr = db.execute("SELECT * FROM friendships WHERE id=? AND addressee_id=?", (fid, me['id'])).fetchone()
                if not fr: return self.send_err('Request not found', 404)
                if action == 'accept':
                    db.execute("UPDATE friendships SET status='accepted' WHERE id=?", (fid,))
                    db.execute("INSERT INTO notifications(id,user_id,actor_id,type,entity_id,message) VALUES(?,?,?,?,?,?)",
                               (str(uuid.uuid4()), fr['requester_id'], me['id'], 'friend_accept', fid, f"{me['name']} accepted your friend request"))
                else:
                    db.execute("DELETE FROM friendships WHERE id=?", (fid,))
                db.commit()
                return self.send_json({'status': 'accepted' if action=='accept' else 'declined'})

            # ── Mark notifications read
            if path == '/api/notifications/read':
                db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (me['id'],))
                db.commit()
                return self.send_json({'ok': True})

            return self.send_err('Not found', 404)

    def do_PUT(self):
        path = urllib.parse.urlparse(self.path).path
        body = self.get_body()

        with get_db() as db:
            me = self.get_current_user(db)
            if not me: return self.send_err('Unauthorized', 401)

            # ── Update profile
            if path == '/api/users/me':
                name = body.get('name', me['name']).strip()
                bio  = body.get('bio', me['bio']).strip()
                year = body.get('year', me.get('year','')).strip()
                dept = body.get('department', me['department']).strip()
                db.execute("UPDATE users SET name=?,bio=?,year=?,department=? WHERE id=?", (name, bio, year, dept, me['id']))
                db.commit()
                user = user_public(db.execute("SELECT * FROM users WHERE id=?", (me['id'],)).fetchone())
                return self.send_json({'user': user})

            return self.send_err('Not found', 404)

    def do_DELETE(self):
        path = urllib.parse.urlparse(self.path).path

        with get_db() as db:
            me = self.get_current_user(db)
            if not me: return self.send_err('Unauthorized', 401)

            # ── Delete post
            if re.match(r'^/api/posts/([^/]+)$', path):
                pid = path.split('/')[-1]
                post = db.execute("SELECT author_id FROM posts WHERE id=?", (pid,)).fetchone()
                if not post: return self.send_err('Not found', 404)
                if post['author_id'] != me['id']: return self.send_err('Forbidden', 403)
                db.execute("DELETE FROM posts WHERE id=?", (pid,))
                db.execute("DELETE FROM likes WHERE post_id=?", (pid,))
                db.execute("DELETE FROM reactions WHERE post_id=?", (pid,))
                db.execute("DELETE FROM comments WHERE post_id=?", (pid,))
                db.commit()
                return self.send_json({'deleted': True})

            return self.send_err('Not found', 404)

    def serve_static(self, path):
        """Serve frontend files"""
        if path == '/': path = '/index.html'
        file_path = os.path.normpath(os.path.join(FRONTEND_DIR, path.lstrip('/')))
        # Security: must stay inside frontend dir
        if not file_path.startswith(os.path.normpath(FRONTEND_DIR)):
            self.send_response(403); self.end_headers(); return
        if not os.path.isfile(file_path):
            # Fall back to index.html for SPA routing
            file_path = os.path.join(FRONTEND_DIR, 'index.html')
        ext = os.path.splitext(file_path)[1]
        mime = {'html':'text/html','css':'text/css','js':'application/javascript',
                'png':'image/png','jpg':'image/jpeg','ico':'image/x-icon',
                'json':'application/json','svg':'image/svg+xml'}.get(ext.lstrip('.'), 'text/plain')
        try:
            with open(file_path, 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', len(data))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'File not found')

if __name__ == '__main__':
    # Verify frontend directory exists
    if not os.path.isdir(FRONTEND_DIR):
        print(f"ERROR: Frontend folder not found at: {FRONTEND_DIR}")
        print("Make sure you run the server from inside the 'campusconnect' folder")
        print("  cd campusconnect")
        print("  python3 backend/server.py")
        exit(1)
    if not os.path.isfile(os.path.join(FRONTEND_DIR, 'index.html')):
        print(f"ERROR: index.html not found in {FRONTEND_DIR}")
        exit(1)
    init_db()
    print(f"""
╔══════════════════════════════════════════╗
║   CampusConnect Backend Server           ║
║   Running on http://localhost:{PORT}        ║
╠══════════════════════════════════════════╣
║  Open browser → http://localhost:{PORT}     ║
╚══════════════════════════════════════════╝
Frontend : {FRONTEND_DIR}
Database : {DB_PATH}
    """)
    server = HTTPServer(('0.0.0.0', PORT), Handler)
    server.serve_forever()
