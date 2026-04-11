class Tmpo < Formula
  desc "Autonomous software delivery pipeline"
  homepage "https://github.com/jasonkatz/tmpo"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpo-darwin-arm64"
      sha256 "PLACEHOLDER"

      resource "tmpod" do
        url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpod-darwin-arm64"
        sha256 "PLACEHOLDER"
      end
    else
      url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpo-darwin-x64"
      sha256 "PLACEHOLDER"

      resource "tmpod" do
        url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpod-darwin-x64"
        sha256 "PLACEHOLDER"
      end
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpo-linux-arm64"
      sha256 "PLACEHOLDER"

      resource "tmpod" do
        url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpod-linux-arm64"
        sha256 "PLACEHOLDER"
      end
    else
      url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpo-linux-x64"
      sha256 "PLACEHOLDER"

      resource "tmpod" do
        url "https://github.com/jasonkatz/tmpo/releases/download/v#{version}/tmpod-linux-x64"
        sha256 "PLACEHOLDER"
      end
    end
  end

  def install
    bin.install stable.url.split("/").last => "tmpo"
    resource("tmpod").stage do
      bin.install Dir["tmpod-*"].first => "tmpod"
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/tmpo --version")
  end
end
