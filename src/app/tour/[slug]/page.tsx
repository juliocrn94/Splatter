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
    .select('name, client_name, spz_r2_key, delivered_at')
    .eq('slug', slug)
    .eq('status', 'delivered')
    .single()

  if (!project?.spz_r2_key) notFound()

  const spzUrl = `${process.env.R2_PUBLIC_URL}/${project.spz_r2_key}`

  return (
    <div className="h-screen w-screen bg-black overflow-hidden">
      <TourViewer
        spzUrl={spzUrl}
        projectName={project.name}
        clientName={project.client_name}
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
