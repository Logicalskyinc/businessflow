import { createClient } from "@supabase/supabase-js";

/**
 * Verify the bearer token with Supabase Auth and attach a user-scoped client.
 * The client uses the public/anon key plus the caller's JWT, so Postgres RLS
 * applies to every database operation. Never use the service-role key here.
 */
export async function requireAuthenticatedUser(request, response, next) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response.status(503).json({
      error: "authentication_not_configured",
      message: "BusinessFlow authentication is not configured on this server."
    });
  }

  const authorization = request.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return response.status(401).json({
      error: "authentication_required",
      message: "Provide a valid Supabase access token in the Authorization header."
    });
  }

  try {
    const accessToken = match[1].trim();
    if (!accessToken || accessToken.length > 8192) {
      return response.status(401).json({
        error: "invalid_token",
        message: "The access token is invalid."
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    });

    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      return response.status(401).json({
        error: "invalid_token",
        message: "The access token is invalid or expired."
      });
    }

    request.user = data.user;
    request.supabase = supabase;
    return next();
  } catch (error) {
    return next(error);
  }
}
