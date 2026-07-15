CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id),
  display_name varchar(120) NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT profiles_display_name_check CHECK (length(display_name) > 0)
);

CREATE UNIQUE INDEX profiles_user_id_unique ON public.profiles (user_id);
ALTER TABLE public.profiles ADD COLUMN avatar_url varchar(500);
ALTER TABLE public.profiles ADD COLUMN invited_user_id uuid;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_invited_user_fk
  FOREIGN KEY (invited_user_id) REFERENCES public.users(id) ON DELETE SET NULL;
