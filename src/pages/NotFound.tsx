import { Link } from 'react-router-dom'

const NotFound = () => {
  return (
    <main className="max-w-4xl mx-auto p-3 sm:p-6">
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <h1 className="mb-4 text-6xl font-bold text-primary">404</h1>
          <h2 className="mb-4 text-2xl font-semibold">Страница не найдена</h2>
          <p className="mb-6 text-muted-foreground">
            Запрашиваемая страница не существует или была перемещена.
          </p>
          <Link to="/" className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
            Вернуться на главную
          </Link>
        </div>
      </div>
    </main>
  )
}

export default NotFound
