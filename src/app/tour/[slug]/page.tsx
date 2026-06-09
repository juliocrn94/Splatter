import { createClient } from '@supabase/supabase-js'
import { notFound } from 'next/navigation'
import TourViewer from './TourViewer'

// Server component — carga datos del proyecto
export default async function TourPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: project } = await supabase
    .from('projects')
    .select('name, client_name, spz_r2_key, delivered_at, contact_phone, is_locked')
    .eq('slug', slug)
    .eq('status', 'delivered')
    .single()

  if (!project?.spz_r2_key) notFound()

  if (project.is_locked) {
    return (
      <div className="h-screen w-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl font-semibold">Este tour no está disponible</p>
          <p className="text-gray-500 text-sm mt-2">El acceso ha sido desactivado temporalmente.</p>
        </div>
      </div>
    )
  }

  const spzUrl = `${process.env.R2_PUBLIC_URL}/${project.spz_r2_key}`

  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <TourViewer
        spzUrl={spzUrl}
        projectName={project.name}
        clientName={project.client_name}
        contactPhone={project.contact_phone ?? undefined}
      />
    </div>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return {
    title: `Tour 3D · ${slug}`,
    description: 'Recorrido virtual fotorrealista de la propiedad',
  }
}
