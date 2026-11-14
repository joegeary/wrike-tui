# Install wrike-tui on Windows, on x64 or arm64.
#
#   irm https://raw.githubusercontent.com/joegeary/wrike-tui/main/install.ps1 | iex
#
# INSTALL_DIR moves where the binary lands, and defaults to
# $env:LOCALAPPDATA\Programs\wrike-tui.
# VERSION pins a release, as v0.2.0, and defaults to the latest.
#
# `wrike-tui update` on Windows runs this script with both set, so it also
# replaces a wrike-tui.exe that is running: Windows will not overwrite a
# running .exe, but it will rename one aside.
#
# This is install.sh for Windows. Change a decision in one and check the other.

# A function because `irm | iex` runs in the caller's session, and its preferences must not outlive the install.
function Install-WrikeTui {
	$ErrorActionPreference = 'Stop'
	$ProgressPreference = 'SilentlyContinue'
	Set-StrictMode -Version Latest

	$repo = 'joegeary/wrike-tui'
	$binary = 'wrike-tui.exe'

	$installDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else {
		Join-Path $env:LOCALAPPDATA 'Programs\wrike-tui'
	}

	# The OS's architecture, not this PowerShell's: x64 PowerShell runs emulated on arm64 Windows.
	$nativeArch = $null
	try {
		$nativeArch = [string][System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
	} catch {
		$nativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
	}
	$arch = switch ($nativeArch) {
		{ $_ -in @('X64', 'AMD64') } { 'x64' }
		'ARM64' { 'arm64' }
		default { $null }
	}
	if (-not $arch) {
		throw "No release binary for Windows on $nativeArch. wrike-tui is built for x64 and arm64."
	}

	$protocols = [Net.ServicePointManager]::SecurityProtocol
	if ([int]$protocols -ne 0 -and -not ($protocols -band [Net.SecurityProtocolType]::Tls12)) {
		[Net.ServicePointManager]::SecurityProtocol = $protocols -bor [Net.SecurityProtocolType]::Tls12
	}

	if ($env:VERSION) {
		$tag = 'v' + $env:VERSION.TrimStart('v')
	} else {
		try {
			$latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest" `
				-Headers @{ 'User-Agent' = 'wrike-tui-installer'; 'Accept' = 'application/vnd.github+json' } -UseBasicParsing
		} catch {
			$lookupError = $_
			$code = $null
			if ($lookupError.Exception.PSObject.Properties['Response'] -and $lookupError.Exception.Response) {
				$code = [int]$lookupError.Exception.Response.StatusCode
			}
			switch ($code) {
				404 { throw 'There is no published release to install yet.' }
				{ $_ -in @(403, 429) } { throw 'The GitHub API refused the lookup, most likely a rate limit. Try again later, or set VERSION=v0.2.0.' }
				default { throw "Could not reach the GitHub API to look up the latest release. $($lookupError.Exception.Message)" }
			}
		}
		$tag = if ($latest.PSObject.Properties['tag_name']) { $latest.tag_name } else { $null }
		if (-not $tag) { throw 'Could not read a tag out of the latest release.' }
	}
	$version = $tag.TrimStart('v')

	$work = Join-Path ([IO.Path]::GetTempPath()) ('wrike-tui-' + [Guid]::NewGuid().ToString('N'))
	New-Item -ItemType Directory -Path $work -Force | Out-Null
	$target = Join-Path $installDir $binary
	$upgrade = Test-Path $target

	try {
		$archive = "wrike-tui-windows-$arch.zip"
		$download = "https://github.com/$repo/releases/download/$tag"
		$archivePath = Join-Path $work $archive
		$sums = Join-Path $work 'SHA256SUMS'

		Write-Host "Downloading wrike-tui $tag for windows-$arch"
		try {
			Invoke-WebRequest -Uri "$download/$archive" -OutFile $archivePath -UseBasicParsing
		} catch {
			throw "Could not download $download/$archive. Is $tag a release with a Windows build?"
		}
		try {
			Invoke-WebRequest -Uri "$download/SHA256SUMS" -OutFile $sums -UseBasicParsing
		} catch {
			throw "Could not download the checksums for $tag."
		}

		# This arrived from the network, so the archive is checked against the
		# checksums the release publishes rather than trusted for arriving.
		$published = Get-Content $sums |
			Where-Object { $_ -match "^[0-9a-fA-F]{64} [ *]?$([regex]::Escape($archive))$" } |
			ForEach-Object { ($_ -split '\s+')[0].ToLower() } |
			Select-Object -First 1
		if (-not $published) {
			throw "$tag publishes no checksum for $archive. Nothing was installed."
		}
		$sum = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
		if ($sum -ne $published) {
			throw "$archive does not match the checksum published for $tag. Nothing was installed."
		}

		$extracted = Join-Path $work 'extracted'
		Expand-Archive -Path $archivePath -DestinationPath $extracted -Force
		$staged = Join-Path $extracted $binary
		if (-not (Test-Path $staged)) {
			throw "$archive holds no $binary. Nothing was installed."
		}

		# Proves the binary starts on this machine before the old one is touched.
		$said = ''
		try {
			$said = ((& $staged --version) -join "`n").Trim()
		} catch {
			$said = $_.Exception.Message
		}
		# The output first: under StrictMode $LASTEXITCODE is unset when the binary never started.
		if ($said -ne "wrike-tui $version" -or $LASTEXITCODE -ne 0) {
			throw "The downloaded binary did not run here (it said `"$said`"). Nothing was installed."
		}

		New-Item -ItemType Directory -Path $installDir -Force | Out-Null

		# A binary renamed aside by an earlier update is removed now that it no
		# longer runs. One still running stays, and this update takes another name.
		Get-ChildItem -Path $installDir -Filter "$binary.*old" -ErrorAction SilentlyContinue |
			ForEach-Object { Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
		$retired = "$target.old"
		if (Test-Path $retired) {
			$retired = "$target.$([Guid]::NewGuid().ToString('N')).old"
		}

		if ($upgrade) {
			try {
				Move-Item -Path $target -Destination $retired -Force
			} catch {
				throw "Could not move the old $target aside. $($_.Exception.Message) Nothing was installed."
			}
		}
		try {
			Move-Item -Path $staged -Destination $target -Force
		} catch {
			if ($upgrade) { Move-Item -Path $retired -Destination $target -Force }
			throw "Could not write $target. $($_.Exception.Message) Nothing was installed."
		}
		# Gone at once when the old binary was not running. When it was, the next install or update removes it.
		if ($upgrade) { Remove-Item $retired -Force -ErrorAction SilentlyContinue }

		Write-Host "Installed wrike-tui $version at $target"
	} finally {
		Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
	}

	$paths = $env:PATH -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }
	if ($installDir.TrimEnd('\') -notin $paths) {
		Write-Host ''
		Write-Host "$installDir is not on your PATH. Add it for your user:"
		Write-Host "    [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + `";$installDir`", 'User')"
		Write-Host 'Then open a new terminal.'
	} else {
		$found = Get-Command 'wrike-tui' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
		if ($found -and $found.Path -ne $target) {
			Write-Host ''
			Write-Host "$($found.Path) comes before it on your PATH, so ``wrike-tui`` still runs that one."
		}
	}

	if (-not $upgrade) {
		Write-Host ''
		Write-Host 'Log in before the first run:'
		Write-Host '    wrike-tui auth login'
	}
}

Install-WrikeTui
