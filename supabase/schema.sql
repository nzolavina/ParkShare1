create table if not exists users (
  id bigserial primary key,
  name text not null,
  email text unique not null,
  role text not null default 'user',
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists listings (
  id bigserial primary key,
  title text not null,
  location text not null,
  type text not null,
  price_per_hour numeric not null check (price_per_hour > 0),
  image text not null,
  features jsonb not null default '[]'::jsonb
);

create table if not exists reservations (
  id bigserial primary key,
  listing_id bigint not null references listings(id) on delete cascade,
  listing_title text not null,
  location text not null,
  price_per_hour numeric not null,
  booking_date date not null,
  booking_time text not null,
  booking_end_time text not null,
  duration_hours int not null,
  total_price numeric not null,
  user_id bigint not null references users(id) on delete cascade,
  user_email text not null,
  status text not null default 'pending',
  receipt_path text,
  approved_at timestamptz,
  approved_by bigint references users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_reservations_listing_date_status
  on reservations (listing_id, booking_date, status);

create table if not exists session (
  sid varchar not null primary key,
  sess json not null,
  expire timestamptz not null
);

create index if not exists idx_session_expire on session (expire);
