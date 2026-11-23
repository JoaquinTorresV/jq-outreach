alter table contacts add column maps_url text;

update contacts
set maps_url = website, website = null
where website ~* '^https?://(www\.)?google\.[^/]+/maps'
   or website ~* '^https?://maps\.google\.';
