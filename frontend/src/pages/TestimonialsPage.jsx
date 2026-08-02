import { useEffect, useState } from "react";
import axios from "axios";
import { PlayCircle } from "lucide-react";

const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

// Public, no-auth route (/testimonials) — this is the link Pre-Sales shares with a lead
// over WhatsApp, so a lead who has never logged into anything can open it straight away.
// Videos shown here are added by Pre-Sales/Branch Admin/Super Admin from the CRM.
export const TestimonialsPage = () => {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`${BACKEND_URL}/api/v3/testimonials`)
      .then(({ data }) => setVideos(data || []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8" data-testid="testimonials-page">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 text-center">
          <img src={LOGO_URL} alt="Fitsiomax" className="mx-auto mb-3 h-12 w-12 rounded-lg object-contain" />
          <p className="text-sm font-semibold text-sky-600">FitsiomaxOS</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Patient Success Stories</h1>
          <p className="mt-1 text-sm text-slate-500">Real patients, real recovery — hear it from them.</p>
        </div>

        {loading ? (
          <p className="text-center text-sm text-slate-400">Loading...</p>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-center">
            <PlayCircle className="h-10 w-10 text-slate-300" />
            <p className="text-sm text-slate-500">No testimonials added yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {videos.map((v) => (
              <div key={v.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid={`testimonial-video-${v.id}`}>
                <div className="aspect-video w-full">
                  <iframe
                    src={`https://www.youtube.com/embed/${v.video_id}`}
                    title={v.title || "Patient testimonial"}
                    className="h-full w-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
                {v.title && <p className="px-4 py-3 text-sm font-medium text-slate-700">{v.title}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
